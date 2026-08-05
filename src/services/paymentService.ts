import type { PaymentMethod, PaymentPurpose, Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, notFound, conflict, forbidden } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { notify } from './notificationService.js';
import { recordAudit } from './auditService.js';
import {
  paymentProvider,
  toPaise,
  fromPaise,
  type TransferLeg,
  type HandoffProof,
} from './payment/provider.js';

/**
 * Checkout, settlement and refunds.
 *
 * The shape is the one quick-commerce apps use: the patient picks a payment
 * method at the end of a basket, prepaid orders are held until the money
 * actually arrives, and cash-on-delivery orders go straight to the partner
 * because the money arrives at the door.
 *
 * Two rules hold this file together.
 *
 *   1. **A client can never mark its own order paid.** `status` only advances
 *      on a signature this server verified — either the checkout handoff or a
 *      webhook. There is no endpoint that takes "paid: true".
 *
 *   2. **The platform does not custody partner money.** Splits are computed
 *      here and handed to the licensed aggregator, which settles each leg. A
 *      design that collected everything into a platform account and paid
 *      partners out later would make this an RBI-regulated payment aggregator.
 *
 * A note on the doctor leg: charging a platform fee for software and patient
 * acquisition is ordinary, but the NMC's ethics regulations prohibit fee
 * splitting for *referrals*. Keep the doctor's commission a flat platform
 * facilitation fee, never a payment for sending patients to a specific
 * provider, and take advice before varying it per doctor.
 */

const CURRENCY = 'INR';

/** COD costs real money when an order is refused at the door. */
const codAllowed = (amount: number): string | null => {
  if (env.COD_ENABLED !== 'true') return 'Cash on delivery is not available right now.';
  if (amount > env.COD_MAX_ORDER_VALUE) {
    return `Cash on delivery is only available up to ₹${env.COD_MAX_ORDER_VALUE}. Please pay online for this order.`;
  }
  return null;
};

/* ------------------------------------------------------------------ *
 * Splits
 * ------------------------------------------------------------------ */

export interface Payee {
  type: 'PHARMACY' | 'LAB' | 'DOCTOR';
  id: string | null;
  payoutAccountId: string | null;
  commissionPercent: number;
  /** Rupees this payee sold, before commission. */
  goodsAmount: number;
}

interface SplitPlan {
  legs: {
    payeeType: 'PHARMACY' | 'LAB' | 'DOCTOR' | 'PLATFORM';
    payeeId: string | null;
    payoutAccountId: string | null;
    /** Integer paise. */
    amountPaise: number;
  }[];
  platformFeePaise: number;
}

/**
 * Splits a total between its payees and the platform.
 *
 * Everything is integer paise and the platform takes the *remainder*, so
 * rounding can never mint or lose a fraction of a rupee: the legs always sum to
 * exactly what the payer is charged, whether there is one payee or five.
 *
 * `deliveryPaise` goes wholly to the platform — the platform arranges delivery,
 * so the pharmacy is not owed it.
 */
const planSplit = (totalPaise: number, deliveryPaise: number, payees: Payee[]): SplitPlan => {
  const legs: SplitPlan['legs'] = [];
  let partnersPaise = 0;

  for (const payee of payees) {
    const goodsPaise = toPaise(payee.goodsAmount);
    const commissionPaise = Math.round((goodsPaise * payee.commissionPercent) / 100);
    const sharePaise = Math.max(0, goodsPaise - commissionPaise);
    if (!payee.id || sharePaise <= 0) continue;

    partnersPaise += sharePaise;
    legs.push({
      payeeType: payee.type,
      payeeId: payee.id,
      payoutAccountId: payee.payoutAccountId,
      amountPaise: sharePaise,
    });
  }

  const platformPaise = totalPaise - partnersPaise;
  legs.push({
    payeeType: 'PLATFORM',
    payeeId: null,
    payoutAccountId: null,
    amountPaise: platformPaise,
  });

  return { legs, platformFeePaise: platformPaise - deliveryPaise };
};

/**
 * Only legs with a linked account become gateway transfers. A partner who has
 * not finished payout onboarding leaves their share in the platform's
 * settlement, flagged PENDING here so it is visible and owed rather than lost.
 */
const toTransfers = (plan: SplitPlan): TransferLeg[] =>
  plan.legs
    .filter((l) => l.payeeType !== 'PLATFORM' && l.payoutAccountId)
    .map((l) => ({
      account: l.payoutAccountId!,
      amount: l.amountPaise,
      notes: { payeeType: l.payeeType, payeeId: l.payeeId ?? '' },
    }));

/* ------------------------------------------------------------------ *
 * What is being paid for
 * ------------------------------------------------------------------ */

interface Chargeable {
  purpose: PaymentPurpose;
  /** Rupees, what the payer is charged in total. */
  amount: number;
  deliveryAmount: number;
  description: string;
  payees: Payee[];
  link: Prisma.PaymentUncheckedCreateInput;
}

const resolveMedicineOrder = async (orderId: string, patientId: string): Promise<Chargeable> => {
  const order = await prisma.medicineOrder.findUnique({
    where: { id: orderId },
    include: {
      pharmacy: { select: { id: true, payoutAccountId: true, commissionPercent: true } },
    },
  });
  // 404 rather than 403 so order ids cannot be probed across patients.
  if (!order || order.patientId !== patientId) throw notFound('Order');
  if (order.status === 'CANCELLED') throw conflict('This order was cancelled.');

  return {
    purpose: 'MEDICINE_ORDER',
    amount: Number((order.totalAmount + order.deliveryFee).toFixed(2)),
    deliveryAmount: order.deliveryFee,
    description: 'Medicine order',
    payees: [
      {
        type: 'PHARMACY',
        id: order.pharmacy?.id ?? null,
        payoutAccountId: order.pharmacy?.payoutAccountId ?? null,
        commissionPercent: order.pharmacy?.commissionPercent ?? env.COMMISSION_PHARMACY_PCT,
        goodsAmount: order.totalAmount,
      },
    ],
    link: { medicineOrderId: order.id } as Prisma.PaymentUncheckedCreateInput,
  };
};

const resolveLabOrder = async (orderId: string, patientId: string): Promise<Chargeable> => {
  const order = await prisma.labOrder.findUnique({
    where: { id: orderId },
    include: {
      labPartner: { select: { id: true, payoutAccountId: true, commissionPercent: true } },
    },
  });
  if (!order || order.patientId !== patientId) throw notFound('Lab booking');
  if (order.status === 'CANCELLED') throw conflict('This booking was cancelled.');

  return {
    purpose: 'LAB_ORDER',
    amount: order.price,
    deliveryAmount: 0,
    description: order.testName,
    payees: [
      {
        type: 'LAB',
        id: order.labPartner?.id ?? null,
        payoutAccountId: order.labPartner?.payoutAccountId ?? null,
        commissionPercent: order.labPartner?.commissionPercent ?? env.COMMISSION_LAB_PCT,
        goodsAmount: order.price,
      },
    ],
    link: { labOrderId: order.id } as Prisma.PaymentUncheckedCreateInput,
  };
};

/**
 * A whole approved prescription basket: the medicine order plus every lab
 * booking that came out of one consent, charged once.
 *
 * Each partner becomes its own settlement leg, so the pharmacy and the two labs
 * are each paid their own share out of a single collection.
 */
const resolveFulfilment = async (
  fulfilmentId: string,
  patientId: string
): Promise<Chargeable> => {
  const fulfilment = await prisma.prescriptionFulfilment.findUnique({
    where: { id: fulfilmentId },
    include: {
      medicineOrders: {
        include: {
          pharmacy: { select: { id: true, payoutAccountId: true, commissionPercent: true } },
        },
      },
      labOrders: {
        include: {
          labPartner: { select: { id: true, payoutAccountId: true, commissionPercent: true } },
        },
      },
    },
  });

  if (!fulfilment || fulfilment.patientId !== patientId) throw notFound('Prescription order');

  const live = {
    medicines: fulfilment.medicineOrders.filter((o) => o.status !== 'CANCELLED'),
    labs: fulfilment.labOrders.filter((o) => o.status !== 'CANCELLED'),
  };

  if (live.medicines.length === 0 && live.labs.length === 0) {
    throw conflict('Every item in this order was cancelled.');
  }

  const payees: Payee[] = [];
  let amount = 0;
  let deliveryAmount = 0;

  for (const order of live.medicines) {
    amount += order.totalAmount + order.deliveryFee;
    deliveryAmount += order.deliveryFee;
    payees.push({
      type: 'PHARMACY',
      id: order.pharmacy?.id ?? null,
      payoutAccountId: order.pharmacy?.payoutAccountId ?? null,
      commissionPercent: order.pharmacy?.commissionPercent ?? env.COMMISSION_PHARMACY_PCT,
      goodsAmount: order.totalAmount,
    });
  }

  for (const order of live.labs) {
    amount += order.price;
    payees.push({
      type: 'LAB',
      id: order.labPartner?.id ?? null,
      payoutAccountId: order.labPartner?.payoutAccountId ?? null,
      commissionPercent: order.labPartner?.commissionPercent ?? env.COMMISSION_LAB_PCT,
      goodsAmount: order.price,
    });
  }

  return {
    purpose: 'PRESCRIPTION_BASKET',
    amount: Number(amount.toFixed(2)),
    deliveryAmount,
    description: 'Prescription order',
    payees,
    link: { fulfilmentId } as Prisma.PaymentUncheckedCreateInput,
  };
};

const resolveAppointment = async (
  appointmentId: string,
  patientId: string
): Promise<Chargeable> => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: {
        select: {
          id: true,
          name: true,
          consultationFee: true,
          payoutAccountId: true,
          commissionPercent: true,
        },
      },
    },
  });
  if (!appointment || appointment.patientId !== patientId) throw notFound('Appointment');
  if (appointment.status === 'CANCELLED') throw conflict('This appointment was cancelled.');

  return {
    purpose: 'APPOINTMENT',
    amount: appointment.doctor.consultationFee,
    deliveryAmount: 0,
    description: `Consultation with ${appointment.doctor.name}`,
    payees: [
      {
        type: 'DOCTOR',
        id: appointment.doctor.id,
        payoutAccountId: appointment.doctor.payoutAccountId,
        commissionPercent: appointment.doctor.commissionPercent ?? env.COMMISSION_DOCTOR_PCT,
        goodsAmount: appointment.doctor.consultationFee,
      },
    ],
    link: { appointmentId: appointment.id } as Prisma.PaymentUncheckedCreateInput,
  };
};

const resolveChargeable = (
  purpose: PaymentPurpose,
  targetId: string,
  patientId: string
): Promise<Chargeable> => {
  if (purpose === 'MEDICINE_ORDER') return resolveMedicineOrder(targetId, patientId);
  if (purpose === 'LAB_ORDER') return resolveLabOrder(targetId, patientId);
  if (purpose === 'PRESCRIPTION_BASKET') return resolveFulfilment(targetId, patientId);
  return resolveAppointment(targetId, patientId);
};

/* ------------------------------------------------------------------ *
 * Checkout
 * ------------------------------------------------------------------ */

export interface CheckoutInput {
  userId: string;
  patientId: string;
  purpose: PaymentPurpose;
  targetId: string;
  method: PaymentMethod;
  ipAddress?: string | null;
}

export interface CheckoutResult {
  paymentId: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  status: string;
  /** Null for COD — there is nothing to open. */
  gatewayOrderId: string | null;
  publicKey: string | null;
  message: string;
}

/**
 * Starts a payment.
 *
 * Idempotent per target: a retried tap returns the payment already in flight
 * rather than opening a second charge for the same order.
 */
export const createCheckoutService = async (input: CheckoutInput): Promise<CheckoutResult> => {
  const chargeable = await resolveChargeable(input.purpose, input.targetId, input.patientId);

  if (chargeable.amount <= 0) throw new AppError('There is nothing to pay for this order.', 400);

  if (input.method === 'COD') {
    // Nothing is handed over at a door for a consultation or a lab visit, so
    // there is no moment at which cash could be collected.
    if (input.purpose === 'APPOINTMENT' || input.purpose === 'LAB_ORDER') {
      throw new AppError('Cash on delivery is only available for delivered orders.', 400);
    }
    const refusal = codAllowed(chargeable.amount);
    if (refusal) throw new AppError(refusal, 400);
  }

  const idempotencyKey = `${input.purpose}:${input.targetId}`;

  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.status === 'PAID') throw conflict('This order has already been paid for.');
    if (existing.status === 'PENDING' && existing.method === input.method) {
      return {
        paymentId: existing.id,
        method: existing.method,
        amount: existing.amount,
        currency: existing.currency,
        status: existing.status,
        gatewayOrderId: existing.gatewayOrderId,
        publicKey: existing.method === 'COD' ? null : env.RAZORPAY_KEY_ID ?? 'mock_key',
        message: 'Resuming your existing checkout.',
      };
    }
    // Changing method (card → COD) abandons the old attempt rather than
    // leaving two live payments against one order.
    await prisma.payment.update({
      where: { id: existing.id },
      data: { status: 'FAILED', failureReason: 'Superseded by a new checkout.' },
    });
    await prisma.payment.update({ where: { id: existing.id }, data: { idempotencyKey: null } });
  }

  const totalPaise = toPaise(chargeable.amount);
  const plan = planSplit(totalPaise, toPaise(chargeable.deliveryAmount), chargeable.payees);

  const payment = await prisma.payment.create({
    data: {
      ...chargeable.link,
      userId: input.userId,
      purpose: chargeable.purpose,
      method: input.method,
      amount: chargeable.amount,
      platformFee: fromPaise(plan.platformFeePaise),
      currency: CURRENCY,
      status: 'PENDING',
      gateway: input.method === 'COD' ? 'cod' : paymentProvider.name,
      idempotencyKey,
      splits: {
        create: plan.legs.map((leg) => ({
          payeeType: leg.payeeType,
          payeeId: leg.payeeId,
          payoutAccountId: leg.payoutAccountId,
          amount: fromPaise(leg.amountPaise),
        })),
      },
    },
  });

  // Cash is collected at the door, so the partner starts work now.
  if (input.method === 'COD') {
    await releaseForFulfilment(payment.id);
    await recordAudit({
      actorUserId: input.userId,
      action: 'payment.cod_selected',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: { purpose: chargeable.purpose, targetId: input.targetId, amount: chargeable.amount },
      ipAddress: input.ipAddress ?? null,
    });

    return {
      paymentId: payment.id,
      method: 'COD',
      amount: chargeable.amount,
      currency: CURRENCY,
      status: 'PENDING',
      gatewayOrderId: null,
      publicKey: null,
      message: `Order confirmed. Pay ₹${chargeable.amount.toFixed(2)} in cash on delivery.`,
    };
  }

  let gatewayOrder;
  try {
    gatewayOrder = await paymentProvider.createOrder({
      amount: totalPaise,
      currency: CURRENCY,
      receipt: payment.id,
      notes: { purpose: chargeable.purpose, targetId: input.targetId },
      transfers: toTransfers(plan),
    });
  } catch (err) {
    // Free the idempotency key so the patient can retry rather than being
    // permanently blocked by one gateway hiccup.
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: (err as Error).message.slice(0, 300),
        idempotencyKey: null,
      },
    });
    throw err;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { gatewayOrderId: gatewayOrder.id },
  });

  return {
    paymentId: payment.id,
    method: input.method,
    amount: chargeable.amount,
    currency: CURRENCY,
    status: 'PENDING',
    gatewayOrderId: gatewayOrder.id,
    publicKey: gatewayOrder.publicKey,
    message: 'Complete the payment to confirm your order.',
  };
};

/* ------------------------------------------------------------------ *
 * Marking a payment paid
 * ------------------------------------------------------------------ */

/**
 * The single place a payment becomes PAID.
 *
 * Both the client handoff and the webhook funnel through here, and both have
 * already had a signature verified by the caller. The status transition is a
 * conditional update, so a webhook racing the client handoff — which happens
 * constantly in practice — settles the order exactly once.
 */
const markPaid = async (
  paymentId: string,
  gatewayPaymentId: string | null
): Promise<{ changed: boolean }> => {
  const claimed = await prisma.payment.updateMany({
    where: { id: paymentId, status: 'PENDING' },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      gatewayPaymentId,
      failureReason: null,
    },
  });

  if (claimed.count === 0) return { changed: false };

  await prisma.paymentSplit.updateMany({
    where: { paymentId, status: 'PENDING' },
    data: { status: 'SETTLED', settledAt: new Date() },
  });

  await releaseForFulfilment(paymentId);
  return { changed: true };
};

/**
 * Releases a paid (or COD) order to the partner who has to act on it.
 *
 * Until this runs the order sits in PENDING_PAYMENT and is filtered out of
 * every partner queue — that is what stops a pharmacy picking and packing an
 * order that was never paid for.
 */
const releaseForFulfilment = async (paymentId: string): Promise<void> => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      medicineOrder: { include: { pharmacy: { select: { userId: true } } } },
      labOrder: { include: { labPartner: { select: { userId: true } } } },
      fulfilment: {
        include: {
          medicineOrders: { include: { pharmacy: { select: { userId: true } } } },
          labOrders: { include: { labPartner: { select: { userId: true } } } },
        },
      },
      appointment: true,
    },
  });
  if (!payment) return;

  // A basket payment covers several orders; a single-order payment covers one.
  // Collecting both into one list keeps the release logic in one place.
  const medicineOrders = payment.fulfilment
    ? payment.fulfilment.medicineOrders
    : payment.medicineOrder
      ? [payment.medicineOrder]
      : [];
  const labOrders = payment.fulfilment
    ? payment.fulfilment.labOrders
    : payment.labOrder
      ? [payment.labOrder]
      : [];

  for (const order of medicineOrders) {
    const released = await prisma.medicineOrder.updateMany({
      where: { id: order.id, status: 'PENDING_PAYMENT' },
      data: { status: 'PLACED' },
    });
    if (released.count > 0 && order.pharmacy) {
      await notify({
        userId: order.pharmacy.userId,
        type: 'ORDER_PLACED',
        title: 'New order',
        body:
          payment.method === 'COD'
            ? `Cash on delivery — collect ₹${payment.amount.toFixed(2)} at the door.`
            : 'Paid online. The order is in your queue.',
        data: { orderId: order.id },
        appId: 'PARTNER',
      });
    }
  }

  for (const order of labOrders) {
    const released = await prisma.labOrder.updateMany({
      where: { id: order.id, status: 'PENDING_PAYMENT' },
      data: { status: order.labPartnerId ? 'ACCEPTED' : 'BOOKED' },
    });
    if (released.count > 0 && order.labPartner) {
      await notify({
        userId: order.labPartner.userId,
        type: 'LAB_BOOKED',
        title: 'New test booking',
        body: `${order.testName} is paid and booked.`,
        data: { labOrderId: order.id },
        appId: 'PARTNER',
      });
    }
  }

  await notify({
    userId: payment.userId,
    type: 'ORDER_STATUS_CHANGED',
    title: payment.method === 'COD' ? 'Order confirmed' : 'Payment received',
    body:
      payment.method === 'COD'
        ? `Pay ₹${payment.amount.toFixed(2)} when it arrives.`
        : `₹${payment.amount.toFixed(2)} paid. Your order is confirmed.`,
    data: {
      paymentId: payment.id,
      orderId: medicineOrders[0]?.id ?? undefined,
      labOrderId: labOrders[0]?.id ?? undefined,
    },
    appId: 'PATIENT',
  });
};

export interface ConfirmInput extends HandoffProof {
  userId: string;
  ipAddress?: string | null;
}

/**
 * The checkout sheet's callback. The signature is what makes this trustworthy —
 * without verifying it, any client could POST an order id and walk away with
 * free medicine.
 */
export const confirmPaymentService = async (input: ConfirmInput) => {
  const payment = await prisma.payment.findFirst({
    where: { gatewayOrderId: input.orderId },
  });
  if (!payment) throw notFound('Payment');
  if (payment.userId !== input.userId) throw notFound('Payment');

  if (!paymentProvider.verifyHandoff(input)) {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'Signature verification failed.' },
    });
    await recordAudit({
      actorUserId: input.userId,
      action: 'payment.signature_rejected',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: { gatewayOrderId: input.orderId },
      ipAddress: input.ipAddress ?? null,
    });
    throw forbidden('Payment could not be verified.');
  }

  const { changed } = await markPaid(payment.id, input.paymentId);

  if (changed) {
    await recordAudit({
      actorUserId: input.userId,
      action: 'payment.captured',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: { amount: payment.amount, method: payment.method },
      ipAddress: input.ipAddress ?? null,
    });
  }

  return {
    paymentId: payment.id,
    status: 'PAID' as const,
    amount: payment.amount,
    // Not an error: the webhook simply arrived first.
    message: changed ? 'Payment confirmed.' : 'This payment was already confirmed.',
  };
};

/* ------------------------------------------------------------------ *
 * Webhooks
 * ------------------------------------------------------------------ */

/**
 * Gateways retry, reorder and duplicate webhooks as a matter of course, so the
 * event is recorded under a unique key *before* it is acted on. A redelivery
 * loses the insert race and is acknowledged without being applied twice.
 *
 * Always answers 2xx once the signature is valid: a non-2xx puts the gateway
 * into a retry loop over a problem retrying will not fix.
 */
export const handleWebhookService = async (rawBody: Buffer, signature: string | undefined) => {
  if (!paymentProvider.verifyWebhook(rawBody, signature)) {
    throw forbidden('Invalid webhook signature.');
  }

  const event = paymentProvider.parseWebhook(rawBody);

  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        gateway: paymentProvider.name,
        eventId: event.eventId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  } catch {
    return { received: true, duplicate: true };
  }

  try {
    const payment = event.orderId
      ? await prisma.payment.findFirst({ where: { gatewayOrderId: event.orderId } })
      : null;

    if (!payment) {
      await prisma.paymentWebhookEvent.updateMany({
        where: { gateway: paymentProvider.name, eventId: event.eventId },
        data: { processedAt: new Date(), error: 'No matching payment.' },
      });
      return { received: true, matched: false };
    }

    if (/captured|paid|success/i.test(event.eventType)) {
      await markPaid(payment.id, event.paymentId);
    } else if (/failed/i.test(event.eventType)) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          failureReason: event.failureReason?.slice(0, 300) ?? 'Payment failed at the gateway.',
        },
      });
      await notify({
        userId: payment.userId,
        type: 'ORDER_STATUS_CHANGED',
        title: 'Payment failed',
        body: 'Your payment did not go through. Nothing was charged — you can try again.',
        data: { paymentId: payment.id },
        appId: 'PATIENT',
      });
    } else if (/refund/i.test(event.eventType)) {
      await prisma.payment.updateMany({
        where: { id: payment.id },
        data: { status: 'REFUNDED', refundedAt: new Date() },
      });
    }

    await prisma.paymentWebhookEvent.updateMany({
      where: { gateway: paymentProvider.name, eventId: event.eventId },
      data: { processedAt: new Date() },
    });

    return { received: true, matched: true };
  } catch (err) {
    // Recorded and surfaced, but still acknowledged — retrying will not fix a
    // bug in our own handler, and a retry storm makes it harder to diagnose.
    logger.error(`[payment] webhook ${event.eventId} failed`, err);
    await prisma.paymentWebhookEvent.updateMany({
      where: { gateway: paymentProvider.name, eventId: event.eventId },
      data: { error: (err as Error).message.slice(0, 300) },
    });
    return { received: true, matched: true, deferred: true };
  }
};

/* ------------------------------------------------------------------ *
 * Refunds and COD collection
 * ------------------------------------------------------------------ */

/**
 * Returns money for a cancelled order.
 *
 * Called from the cancellation paths rather than exposed to patients directly —
 * a refund is a consequence of cancelling, not an action of its own. Never
 * throws into the cancellation: an order that could not be refunded is still
 * cancelled, and the failure is logged and left visible for an admin.
 */
export const refundForTargetService = async (
  target: {
    medicineOrderId?: string;
    labOrderId?: string;
    appointmentId?: string;
    fulfilmentId?: string;
  },
  reason: string
): Promise<{ refunded: boolean; amount: number }> => {
  if (Object.values(target).every((v) => !v)) return { refunded: false, amount: 0 };

  const payment = await prisma.payment.findFirst({
    where: {
      ...(target.medicineOrderId ? { medicineOrderId: target.medicineOrderId } : {}),
      ...(target.labOrderId ? { labOrderId: target.labOrderId } : {}),
      ...(target.appointmentId ? { appointmentId: target.appointmentId } : {}),
      ...(target.fulfilmentId ? { fulfilmentId: target.fulfilmentId } : {}),
    },
  });

  if (!payment) return { refunded: false, amount: 0 };

  // Nothing was ever collected on an unpaid or COD order.
  if (payment.status !== 'PAID') {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason.slice(0, 300) },
    });
    return { refunded: false, amount: 0 };
  }

  if (payment.method === 'COD') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundedAt: new Date(), refundReason: reason.slice(0, 300) },
    });
    return { refunded: true, amount: payment.amount };
  }

  try {
    const outstanding = payment.amount - payment.refundedAmount;
    if (outstanding <= 0) return { refunded: false, amount: 0 };

    const { refundId } = await paymentProvider.refund(
      payment.gatewayPaymentId!,
      toPaise(outstanding),
      reason
    );

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUNDED',
          refundedAmount: payment.amount,
          refundedAt: new Date(),
          refundReason: reason.slice(0, 300),
          gatewayRefundId: refundId,
        },
      }),
      prisma.paymentSplit.updateMany({
        where: { paymentId: payment.id },
        data: { status: 'REVERSED' },
      }),
    ]);

    await notify({
      userId: payment.userId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Refund started',
      body: `₹${outstanding.toFixed(2)} is on its way back to you. Banks usually take 3–5 working days.`,
      data: { paymentId: payment.id },
      appId: 'PATIENT',
    });

    return { refunded: true, amount: outstanding };
  } catch (err) {
    // The order is still cancelled; the money is not stuck, just not yet
    // returned. Loud, and left PAID so a retry is obviously outstanding.
    logger.error(`[payment] refund failed for ${payment.id}`, err);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { refundReason: `FAILED: ${reason}`.slice(0, 300) },
    });
    return { refunded: false, amount: 0 };
  }
};

/**
 * The delivery agent or pharmacy confirms the cash actually arrived.
 *
 * Only callable by the pharmacy the order was routed to or the agent assigned
 * to it — otherwise anyone could clear a debt that was never settled.
 */
export const markCodCollectedService = async (orderId: string, actorUserId: string) => {
  const order = await prisma.medicineOrder.findUnique({
    where: { id: orderId },
    include: {
      pharmacy: { select: { userId: true } },
      payment: true,
      // An order from an approved prescription is paid as part of the whole
      // basket, so its payment hangs off the fulfilment, not the order.
      fulfilment: { select: { payment: true } },
    },
  });
  if (!order) throw notFound('Order');

  const isPharmacy = order.pharmacy?.userId === actorUserId;
  const isAgent = order.assignedAgentUserId === actorUserId;
  if (!isPharmacy && !isAgent) throw notFound('Order');

  const payment = order.payment ?? order.fulfilment?.payment ?? null;
  if (!payment || payment.method !== 'COD') {
    throw new AppError('This order was not a cash-on-delivery order.', 400);
  }

  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'PENDING' },
    data: { status: 'PAID', paidAt: new Date() },
  });
  if (claimed.count === 0) throw conflict('This payment is already settled.');

  await prisma.paymentSplit.updateMany({
    where: { paymentId: payment.id, status: 'PENDING' },
    data: { status: 'SETTLED', settledAt: new Date() },
  });

  await recordAudit({
    actorUserId,
    action: 'payment.cod_collected',
    entityType: 'Payment',
    entityId: payment.id,
    metadata: { orderId, amount: payment.amount },
  });

  return { paymentId: payment.id, status: 'PAID' as const, amount: payment.amount };
};

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

const publicPayment = (row: {
  id: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: number;
  currency: string;
  status: string;
  paidAt: Date | null;
  refundedAmount: number;
  refundedAt: Date | null;
  createdAt: Date;
  medicineOrderId: string | null;
  labOrderId: string | null;
  appointmentId: string | null;
  fulfilmentId: string | null;
}) => ({
  id: row.id,
  purpose: row.purpose,
  method: row.method,
  amount: row.amount,
  currency: row.currency,
  status: row.status,
  paidAt: row.paidAt,
  refundedAmount: row.refundedAmount,
  refundedAt: row.refundedAt,
  createdAt: row.createdAt,
  medicineOrderId: row.medicineOrderId,
  labOrderId: row.labOrderId,
  appointmentId: row.appointmentId,
  fulfilmentId: row.fulfilmentId,
});

/** Gateway ids and split arithmetic stay server-side; this is the payer's view. */
export const listMyPaymentsService = async (userId: string, limit = 50) => {
  const rows = await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });
  return rows.map(publicPayment);
};

export const getPaymentService = async (id: string, userId: string) => {
  const row = await prisma.payment.findUnique({ where: { id } });
  if (!row || row.userId !== userId) throw notFound('Payment');
  return publicPayment(row);
};

/** What a partner is owed. Their own legs only. */
export const listPartnerEarningsService = async (
  payeeType: 'PHARMACY' | 'LAB' | 'DOCTOR',
  payeeId: string,
  limit = 100
) => {
  const splits = await prisma.paymentSplit.findMany({
    where: { payeeType, payeeId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    include: { payment: { select: { purpose: true, method: true, status: true, paidAt: true } } },
  });

  const settled = splits
    .filter((s) => s.status === 'SETTLED')
    .reduce((sum, s) => sum + s.amount, 0);
  const pending = splits
    .filter((s) => s.status === 'PENDING')
    .reduce((sum, s) => sum + s.amount, 0);

  return {
    settledTotal: Number(settled.toFixed(2)),
    pendingTotal: Number(pending.toFixed(2)),
    lines: splits.map((s) => ({
      id: s.id,
      amount: s.amount,
      status: s.status,
      settledAt: s.settledAt,
      createdAt: s.createdAt,
      purpose: s.payment.purpose,
      method: s.payment.method,
      paymentStatus: s.payment.status,
    })),
  };
};
