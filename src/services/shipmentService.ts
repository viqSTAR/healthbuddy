import type { OrderStatus } from '@prisma/client';
import { prisma } from '../config/db.js';
import { toNum } from '../utils/money.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { refundForTargetService, settleCodOnFinalDeliveryService } from './paymentService.js';
import { consumeReservedStock, releaseReservedStock } from './stockService.js';
import { logger } from '../utils/logger.js';

/**
 * A shipment is the unit a pharmacy actually works on.
 *
 * The order belongs to the patient and spans however many shops it took to fill
 * the basket. This file is the shop's half of that: it accepts, packs,
 * dispatches and — when it has to — cancels only the lines it is responsible
 * for, against only the stock it reserved.
 */

const SHIPMENT_TIMESTAMPS: Partial<Record<OrderStatus, 'dispatchedAt' | 'deliveredAt'>> = {
  DISPATCHED: 'dispatchedAt',
  DELIVERED: 'deliveredAt',
};

const shipmentLines = (items: unknown) =>
  ((items as { medicineId?: string; quantity: number }[] | null) ?? [])
    .filter((i): i is { medicineId: string; quantity: number } => Boolean(i.medicineId))
    .map((i) => ({ medicineId: i.medicineId, quantity: i.quantity }));

export const getPharmacyShipmentQueueService = async (
  pharmacyId: string,
  status?: OrderStatus,
  limit = 100
) => {
  const paymentView = { select: { method: true, status: true, amount: true } };

  const shipments = await prisma.shipment.findMany({
    where: {
      pharmacyId,
      ...(status && status !== 'PENDING_PAYMENT'
        ? { status }
        : { status: { not: 'PENDING_PAYMENT' } }),
      // A shop must not pick and pack against money that has not arrived.
      order: { status: { not: 'PENDING_PAYMENT' } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 200),
    include: {
      assignedAgent: { select: { id: true, phoneNumber: true } },
      order: {
        select: {
          id: true,
          address: true,
          pincode: true,
          createdAt: true,
          prescriptionId: true,
          patient: { select: { id: true, fullName: true, emergencyContact: true } },
          payment: paymentView,
          fulfilment: { select: { payment: paymentView } },
          // So a shop can see it is one of several, and does not chase the
          // patient about items that were never its to send.
          _count: { select: { shipments: true } },
        },
      },
    },
  });

  return shipments.map(({ order, ...shipment }) => {
    const { fulfilment, _count, ...rest } = order;
    return {
      ...shipment,
      order: {
        ...rest,
        payment: order.payment ?? fulfilment?.payment ?? null,
        shipmentCount: _count.shipments,
      },
    };
  });
};

/**
 * Claims an unaccepted shipment for the pharmacy it was routed to.
 *
 * Unlike the old open-order queue there is no race to win: a shipment is
 * created already addressed to the shop whose shelf its stock is reserved on.
 * The conditional update is still here so a double tap cannot re-stamp
 * `acceptedAt` and reset the clock the dispatch board measures against.
 */
export const acceptShipmentService = async (shipmentId: string, pharmacyId: string) => {
  const claimed = await prisma.shipment.updateMany({
    where: { id: shipmentId, pharmacyId, status: 'PLACED' },
    data: { status: 'ACCEPTED', acceptedAt: new Date() },
  });

  if (claimed.count === 0) {
    const existing = await prisma.shipment.findFirst({
      where: { id: shipmentId, pharmacyId },
      select: { status: true },
    });
    if (!existing) throw notFound('Shipment');
    throw conflict(`This shipment is already ${existing.status.toLowerCase()}.`);
  }

  return prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
};

export const updateShipmentStatusService = async (
  shipmentId: string,
  pharmacyId: string,
  status: OrderStatus,
  cancelReason?: string
) => {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, pharmacyId },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          prescriptionId: true,
          fulfilmentId: true,
          patient: { select: { userId: true } },
        },
      },
    },
  });
  if (!shipment) throw notFound('Shipment');

  if (shipment.order.status === 'PENDING_PAYMENT') {
    throw conflict('This order has not been paid for yet.');
  }
  if (shipment.status === 'DELIVERED' || shipment.status === 'CANCELLED') {
    throw conflict(`This shipment is already ${shipment.status.toLowerCase()}.`);
  }

  const lines = shipmentLines(shipment.items);

  // A prescription-only line must not leave the shop without one on file. The
  // check is against this shipment's own items: another shop's antibiotic is
  // not this shop's problem, and blocking on it would strand the parcel.
  if (status === 'DISPATCHED' && lines.length > 0) {
    const rxRequired = await prisma.medicine.count({
      where: { id: { in: lines.map((l) => l.medicineId) }, requiresPrescription: true },
    });
    if (rxRequired > 0 && !shipment.order.prescriptionId) {
      throw new AppError(
        'This shipment contains prescription-only medicine and has no prescription attached.',
        422
      );
    }
  }

  const stamp = SHIPMENT_TIMESTAMPS[status];

  const updated = await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status,
      ...(stamp ? { [stamp]: new Date() } : {}),
      ...(status === 'CANCELLED' && cancelReason ? { cancelReason } : {}),
      /**
       * The rider's exact position does not outlive the parcel it was following.
       *
       * It exists so a dispatcher can see which junction a live delivery is
       * stuck at. Once the parcel is handed over or cancelled there is nothing
       * to dispatch, and what remains is a record of where a named person stood
       * at a given minute, kept forever for no reason. The named places stay —
       * they are the delivery's own history and carry no precision.
       */
      ...(status === 'DELIVERED' || status === 'CANCELLED'
        ? { riderLatitude: null, riderLongitude: null, riderSeenAt: null }
        : {}),
    },
  });

  // Dispatch is when the boxes physically leave, so the reservation becomes a
  // deduction and the ledger gains a SALE_ONLINE line.
  if (status === 'DISPATCHED' && lines.length > 0) {
    await consumeReservedStock(pharmacyId, lines, shipment.orderId);
  }

  let refund = { refunded: false, amount: 0 };

  if (status === 'CANCELLED') {
    if (lines.length > 0) {
      await releaseReservedStock(pharmacyId, lines, shipment.orderId);
    }

    // Is anything still coming? If every parcel is now cancelled the order is
    // cancelled too and the whole payment goes back; if others are still
    // shipping only this parcel's share does.
    const liveElsewhere = await prisma.shipment.count({
      where: { orderId: shipment.orderId, id: { not: shipmentId }, status: { not: 'CANCELLED' } },
    });

    const target = shipment.order.fulfilmentId
      ? { fulfilmentId: shipment.order.fulfilmentId }
      : { medicineOrderId: shipment.orderId };

    refund =
      liveElsewhere === 0
        ? await refundForTargetService(target, cancelReason ?? 'Order cancelled by the pharmacy.')
        : await refundForTargetService(
            target,
            cancelReason ?? 'Part of your order was cancelled by the pharmacy.',
            { amount: toNum(shipment.subtotal), splitPayeeId: pharmacyId }
          );
  }

  /**
   * The cash arrives when the last box does.
   *
   * A shop can only see its own parcel, so no shop can tell whether it just
   * delivered the last one — the client used to try, and settled only orders
   * that happened to have exactly one parcel. Every split cash order was
   * therefore delivered in full and never marked paid, leaving both pharmacies
   * unsettled against money the rider had already collected.
   *
   * Cancelled siblings count as finished: if one shop cancelled and the other
   * delivered, nothing further is coming and what was collected is what is due.
   */
  if (status === 'DELIVERED') {
    const stillComing = await prisma.shipment.count({
      where: {
        orderId: shipment.orderId,
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
    });

    if (stillComing === 0) {
      // Never throws into a delivery: the parcel genuinely arrived, and a
      // settlement problem must not make the shop think it did not.
      await settleCodOnFinalDeliveryService(shipment.orderId).catch((err: unknown) =>
        logger.error(`[cod] could not settle order ${shipment.orderId}`, err)
      );
    }
  }

  await syncOrderStatusService(shipment.orderId);

  await notify({
    userId: shipment.order.patient.userId,
    type: 'ORDER_STATUS_CHANGED',
    title: 'Order update',
    body:
      status === 'CANCELLED' && refund.refunded
        ? `Part of your order was cancelled. ₹${refund.amount.toFixed(2)} is being refunded.`
        : `One of your parcels is now ${status.toLowerCase()}.`,
    data: { orderId: shipment.orderId, shipmentId, status },
    appId: 'PATIENT',
  });

  return updated;
};

/**
 * Writes the order's own status back from its shipments.
 *
 * The order row is a cache of the parcels: reads derive it anyway, but keeping
 * the column truthful means queue filters, the admin board and anything else
 * that filters on `status` in SQL see the same answer the API reports.
 */
export const syncOrderStatusService = async (orderId: string) => {
  const { deriveOrderStatus } = await import('./pharmacyService.js');

  const order = await prisma.medicineOrder.findUnique({
    where: { id: orderId },
    select: { status: true, shipments: { select: { status: true } } },
  });
  if (!order || order.shipments.length === 0) return;

  const derived = deriveOrderStatus(order.shipments, order.status);
  if (derived === order.status) return;

  await prisma.medicineOrder.update({
    where: { id: orderId },
    data: {
      status: derived,
      ...(derived === 'DISPATCHED' ? { dispatchedAt: new Date() } : {}),
      ...(derived === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
    },
  });
};

/**
 * Hands a parcel to a rider.
 *
 * The user id is checked against the agent roster before it is written. It
 * used to be stored as given, which meant a shop could name any account on the
 * platform — a patient, a rival shop — and, now that agents can read the jobs
 * assigned to them, that would have handed a stranger the customer's name,
 * phone number and door number.
 */
export const assignShipmentAgentService = async (
  shipmentId: string,
  pharmacyId: string,
  agentUserId: string | null
) => {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, pharmacyId },
    select: { id: true },
  });
  if (!shipment) throw notFound('Shipment');

  if (agentUserId) {
    const agent = await prisma.deliveryAgent.findUnique({
      where: { userId: agentUserId },
      select: { isActive: true },
    });
    if (!agent) throw new AppError('That account is not a delivery agent.', 422);
    if (!agent.isActive) throw new AppError('That agent is not active.', 422);
  }

  return prisma.shipment.update({
    where: { id: shipmentId },
    data: { assignedAgentUserId: agentUserId },
  });
};
