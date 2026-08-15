import type { PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { recordAudit } from './auditService.js';
import { createCheckoutService } from './paymentService.js';
import { resolveTestPriceService } from './inventoryService.js';
import { reserveStockForOrder } from './stockService.js';
import { logger } from '../utils/logger.js';

/**
 * Turning a prescription into real orders.
 *
 * The rule this file exists to enforce: **a prescription is clinical advice,
 * not a purchase.** Auto-ordering the moment a doctor prescribes would charge a
 * patient for something they never agreed to buy, from a pharmacy they did not
 * pick, at a price they never saw.
 *
 * So issuing a prescription creates a fulfilment in PENDING_CONSENT holding a
 * priced basket. It creates nothing else. Only `consentToFulfilmentService` —
 * callable solely by the patient who owns it — turns that into a MedicineOrder
 * and LabOrders. Ignored, it expires untouched.
 */

/** Offers go stale as prices and stock move; don't let one linger. */
const CONSENT_WINDOW_HOURS = 72;

const DEFAULT_DELIVERY_FEE = 40;
/** Most pharmacies waive delivery above a basket threshold. */
const FREE_DELIVERY_ABOVE = 500;

export interface MedicineQuoteLine {
  medicineId: string;
  name: string;
  dosage: string;
  frequency: string;
  durationDays: number | null;
  /** Derived from dosage × frequency × duration, floored at 1 pack. */
  quantity: number;
  unitPrice: number;
  itemTotal: number;
  pharmacyId: string;
  pharmacyName: string;
  requiresPrescription: boolean;
  /** Set when nothing in stock anywhere — shown to the patient, not silently dropped. */
  unavailableReason?: string;
}

export interface LabQuoteLine {
  labPackageId: string | null;
  testName: string;
  instructions: string | null;
  urgent: boolean;
  price: number | null;
  homeCollectionFee: number;
  labPartnerId: string | null;
  labPartnerName: string | null;
  unavailableReason?: string;
}

/**
 * Rough pack count from the dosage instructions.
 *
 * Deliberately conservative and always at least 1: over-ordering medicine is a
 * real cost to the patient, and the basket is reviewed before anything is
 * bought, so a low estimate is safe and a high one is not.
 */
const estimateQuantity = (frequency: string, durationDays: number | null): number => {
  if (!durationDays || durationDays < 1) return 1;

  const f = frequency.toLowerCase();
  let perDay = 1;
  if (/thrice|three times|tds|8\s*hour/.test(f)) perDay = 3;
  else if (/twice|two times|bd|12\s*hour/.test(f)) perDay = 2;
  else if (/four times|qid|6\s*hour/.test(f)) perDay = 4;

  // Strips are typically 10–15 units; one strip per 10 doses is a fair floor.
  return Math.max(1, Math.ceil((perDay * durationDays) / 10));
};

/** Cheapest in-stock listing across active pharmacies. */
const quoteMedicine = async (
  medicineId: string,
  quantity: number
): Promise<{ price: number; pharmacyId: string; pharmacyName: string } | null> => {
  const offer = await prisma.pharmacyInventory.findFirst({
    where: {
      medicineId,
      isActive: true,
      stock: { gte: quantity },
      pharmacy: { isActive: true },
    },
    orderBy: { price: 'asc' },
    select: { price: true, pharmacy: { select: { id: true, name: true } } },
  });

  if (!offer) return null;
  return { price: offer.price, pharmacyId: offer.pharmacy.id, pharmacyName: offer.pharmacy.name };
};

/**
 * Picks a lab for a test and prices it from the area band.
 *
 * There is no cheapest lab to find any more — every lab in an area charges the
 * same for a test — so the choice is made on turnaround, then accreditation.
 * That is the ordering a patient would actually want if they knew to ask.
 */
const quoteLabTest = async (labPackageId: string) => {
  const offer = await prisma.labOffering.findFirst({
    where: { labPackageId, isActive: true, labPartner: { isActive: true } },
    orderBy: [{ turnaroundHours: 'asc' }],
    select: {
      labPartner: { select: { id: true, name: true, state: true, city: true } },
    },
  });

  if (!offer) return null;

  const resolved = await resolveTestPriceService(labPackageId, {
    state: offer.labPartner.state,
    city: offer.labPartner.city,
  });
  if (!resolved) return null;

  return {
    price: resolved.price,
    homeCollectionFee: resolved.homeCollectionFee,
    labPartnerId: offer.labPartner.id,
    labPartnerName: offer.labPartner.name,
  };
};

/**
 * Builds the priced basket for a freshly issued prescription.
 *
 * Called from prescriptionService right after the prescription is written.
 * Never throws into that path — a pricing failure must not undo a valid
 * prescription, so problems are logged and the fulfilment is simply skipped.
 */
export const createFulfilmentForPrescription = async (prescriptionId: string): Promise<void> => {
  try {
    const prescription = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        items: { include: { medicine: true } },
        labTests: true,
        patient: { select: { id: true, userId: true } },
      },
    });

    if (!prescription) return;

    const medicineQuote: MedicineQuoteLine[] = [];
    let medicineTotal = 0;

    for (const item of prescription.items) {
      // A hand-typed drug has no catalogue entry, so it cannot be priced or
      // ordered — surfaced to the patient rather than dropped.
      if (!item.medicineId || !item.medicine) {
        medicineQuote.push({
          medicineId: '',
          name: item.name,
          dosage: item.dosage,
          frequency: item.frequency,
          durationDays: item.durationDays,
          quantity: 1,
          unitPrice: 0,
          itemTotal: 0,
          pharmacyId: '',
          pharmacyName: '',
          requiresPrescription: false,
          unavailableReason: 'Not in our catalogue — ask any pharmacy for this one.',
        });
        continue;
      }

      const quantity = estimateQuantity(item.frequency, item.durationDays);
      const offer = await quoteMedicine(item.medicineId, quantity);

      if (!offer) {
        medicineQuote.push({
          medicineId: item.medicineId,
          name: item.name,
          dosage: item.dosage,
          frequency: item.frequency,
          durationDays: item.durationDays,
          quantity,
          unitPrice: 0,
          itemTotal: 0,
          pharmacyId: '',
          pharmacyName: '',
          requiresPrescription: item.medicine.requiresPrescription,
          unavailableReason: 'Out of stock nearby right now.',
        });
        continue;
      }

      const itemTotal = Number((offer.price * quantity).toFixed(2));
      medicineTotal += itemTotal;

      medicineQuote.push({
        medicineId: item.medicineId,
        name: item.name,
        dosage: item.dosage,
        frequency: item.frequency,
        durationDays: item.durationDays,
        quantity,
        unitPrice: offer.price,
        itemTotal,
        pharmacyId: offer.pharmacyId,
        pharmacyName: offer.pharmacyName,
        requiresPrescription: item.medicine.requiresPrescription,
      });
    }

    const labQuote: LabQuoteLine[] = [];
    let labTotal = 0;

    for (const test of prescription.labTests) {
      const offer = test.labPackageId ? await quoteLabTest(test.labPackageId) : null;

      if (!offer) {
        labQuote.push({
          labPackageId: test.labPackageId,
          testName: test.testName,
          instructions: test.instructions,
          urgent: test.urgent,
          price: null,
          homeCollectionFee: 0,
          labPartnerId: null,
          labPartnerName: null,
          unavailableReason: 'No partner lab offers this test yet.',
        });
        continue;
      }

      labTotal += offer.price + offer.homeCollectionFee;
      labQuote.push({
        labPackageId: test.labPackageId,
        testName: test.testName,
        instructions: test.instructions,
        urgent: test.urgent,
        price: offer.price,
        homeCollectionFee: offer.homeCollectionFee,
        labPartnerId: offer.labPartnerId,
        labPartnerName: offer.labPartnerName,
      });
    }

    // Nothing orderable — don't ask for consent to an empty basket.
    const orderable =
      medicineQuote.some((m) => !m.unavailableReason) || labQuote.some((l) => !l.unavailableReason);
    if (!orderable) return;

    const deliveryFee =
      medicineTotal > 0 && medicineTotal < FREE_DELIVERY_ABOVE ? DEFAULT_DELIVERY_FEE : 0;

    const fulfilment = await prisma.prescriptionFulfilment.create({
      data: {
        prescriptionId,
        patientId: prescription.patientId,
        medicineQuote: medicineQuote as unknown as Prisma.InputJsonValue,
        labQuote: labQuote as unknown as Prisma.InputJsonValue,
        medicineTotal: Number(medicineTotal.toFixed(2)),
        labTotal: Number(labTotal.toFixed(2)),
        deliveryFee,
        expiresAt: new Date(Date.now() + CONSENT_WINDOW_HOURS * 3600_000),
      },
    });

    const total = medicineTotal + labTotal + deliveryFee;

    await notify({
      userId: prescription.patient.userId,
      type: 'PRESCRIPTION_ISSUED',
      title: 'Your prescription is ready to order',
      body: `${medicineQuote.length} medicine(s) and ${labQuote.length} test(s) — ₹${total.toFixed(0)}. Review and approve to have it delivered.`,
      data: { fulfilmentId: fulfilment.id, prescriptionId },
      appId: 'PATIENT',
    });
  } catch (err) {
    // A pricing failure must never undo a valid prescription.
    logger.error(`[fulfilment] could not build basket for prescription ${prescriptionId}`, err);
  }
};

const publicFulfilment = (
  row: Prisma.PrescriptionFulfilmentGetPayload<{
    include: { prescription: { include: { doctor: true } } };
  }>
) => ({
  id: row.id,
  prescriptionId: row.prescriptionId,
  status: row.status,
  medicines: (row.medicineQuote ?? []) as unknown as MedicineQuoteLine[],
  labTests: (row.labQuote ?? []) as unknown as LabQuoteLine[],
  medicineTotal: row.medicineTotal,
  labTotal: row.labTotal,
  deliveryFee: row.deliveryFee,
  grandTotal: Number((row.medicineTotal + row.labTotal + row.deliveryFee).toFixed(2)),
  expiresAt: row.expiresAt,
  consentedAt: row.consentedAt,
  declinedAt: row.declinedAt,
  declineReason: row.declineReason,
  createdAt: row.createdAt,
  diagnosis: row.prescription.diagnosis,
  doctorName: row.prescription.doctor.name,
});

export const listMyFulfilmentsService = async (patientId: string) => {
  const rows = await prisma.prescriptionFulfilment.findMany({
    where: { patientId },
    include: { prescription: { include: { doctor: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map(publicFulfilment);
};

/** 404 rather than 403 so fulfilment ids cannot be probed across patients. */
export const getFulfilmentService = async (id: string, patientId: string) => {
  const row = await prisma.prescriptionFulfilment.findUnique({
    where: { id },
    include: { prescription: { include: { doctor: true } } },
  });
  if (!row || row.patientId !== patientId) throw notFound('Prescription order');
  return publicFulfilment(row);
};

export interface ConsentInput {
  fulfilmentId: string;
  patientId: string;
  userId: string;
  /** Lets the patient drop items they already have. Empty means "everything". */
  acceptMedicineIds?: string[];
  acceptLabPackageIds?: string[];
  /**
   * A saved address, preferred. The only form carrying a pincode the platform
   * has validated, and the same book medicine and lab orders already use — a
   * patient should not be retyping their address once per order type.
   */
  addressId?: string;
  /** Typed address, for a patient who has not saved one. */
  deliveryAddress?: string;
  latitude?: number;
  longitude?: number;
  paymentMethod: PaymentMethod;
  ipAddress?: string | null;
}

/**
 * The consent action. Creates the real orders and opens the checkout.
 *
 * Prices come from the stored quote, never from the request — the patient is
 * charged exactly what they were shown. The status transition is a conditional
 * update so a double-tap cannot produce two sets of orders.
 *
 * Orders are created in PENDING_PAYMENT and are invisible to partners until the
 * money is confirmed. Cash on delivery is the exception: the cash arrives at
 * the door, so those orders are released immediately.
 */
export const consentToFulfilmentService = async (input: ConsentInput) => {
  const fulfilment = await prisma.prescriptionFulfilment.findUnique({
    where: { id: input.fulfilmentId },
    include: { patient: { select: { userId: true } } },
  });

  if (!fulfilment || fulfilment.patientId !== input.patientId) {
    throw notFound('Prescription order');
  }
  if (fulfilment.status === 'CONSENTED') {
    throw conflict('You have already approved this order.');
  }
  if (fulfilment.status === 'DECLINED') {
    throw conflict('You declined this order. Reorder it to get a fresh quote.');
  }
  if (fulfilment.expiresAt < new Date()) {
    await prisma.prescriptionFulfilment.updateMany({
      where: { id: fulfilment.id, status: 'PENDING_CONSENT' },
      data: { status: 'EXPIRED' },
    });
    // Reorder rather than "ask your doctor": the prescription is still valid,
    // it is the *prices* that went stale, and re-quoting needs no clinical
    // decision — sending the patient back to the doctor for one would be
    // friction with no safety value.
    throw new AppError('This offer has expired. Reorder it for current prices.', 410);
  }

  /**
   * Where it goes. A saved address wins, and is copied rather than referenced —
   * an address-book entry can be edited afterwards, and an order must record
   * where it was actually sent.
   */
  let deliveryAddress = input.deliveryAddress?.trim() ?? '';

  if (input.addressId) {
    const saved = await prisma.address.findFirst({
      where: { id: input.addressId, patientId: input.patientId },
      select: { line1: true, line2: true, landmark: true, city: true, state: true, pincode: true },
    });
    if (!saved) throw notFound('Address');

    deliveryAddress = [saved.line1, saved.line2, saved.landmark, saved.city, saved.state, saved.pincode]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(', ');
  }

  if (deliveryAddress.length < 5) {
    throw new AppError('A delivery address is required.', 400);
  }

  const medicines = (fulfilment.medicineQuote ?? []) as unknown as MedicineQuoteLine[];
  const labTests = (fulfilment.labQuote ?? []) as unknown as LabQuoteLine[];

  const wantsMedicine = (line: MedicineQuoteLine) =>
    !line.unavailableReason &&
    (!input.acceptMedicineIds?.length || input.acceptMedicineIds.includes(line.medicineId));

  const wantsTest = (line: LabQuoteLine) =>
    !line.unavailableReason &&
    line.labPackageId !== null &&
    (!input.acceptLabPackageIds?.length || input.acceptLabPackageIds.includes(line.labPackageId));

  const chosenMedicines = medicines.filter(wantsMedicine);
  const chosenTests = labTests.filter(wantsTest);

  if (chosenMedicines.length === 0 && chosenTests.length === 0) {
    throw new AppError('Select at least one item to order.', 400);
  }

  // Claim the fulfilment first: a conditional update means a double-tap loses
  // the race and cannot create a second set of orders.
  const claimed = await prisma.prescriptionFulfilment.updateMany({
    where: { id: fulfilment.id, status: 'PENDING_CONSENT' },
    data: { status: 'CONSENTED', consentedAt: new Date() },
  });
  if (claimed.count === 0) throw conflict('This order has already been processed.');

  const created: { medicineOrderId?: string; labOrderIds: string[] } = { labOrderIds: [] };

  try {
    if (chosenMedicines.length > 0) {
      const total = chosenMedicines.reduce((sum, m) => sum + m.itemTotal, 0);
      const deliveryFee = total < FREE_DELIVERY_ABOVE ? DEFAULT_DELIVERY_FEE : 0;

      // Route to the pharmacy that quoted the most lines, so one shop fills the
      // basket wherever possible.
      const byPharmacy = new Map<string, number>();
      for (const line of chosenMedicines) {
        byPharmacy.set(line.pharmacyId, (byPharmacy.get(line.pharmacyId) ?? 0) + 1);
      }
      const pharmacyId = [...byPharmacy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

      const order = await prisma.medicineOrder.create({
        data: {
          patientId: input.patientId,
          pharmacyId: pharmacyId ?? null,
          items: chosenMedicines.map((m) => ({
            medicineId: m.medicineId,
            name: m.name,
            price: m.unitPrice,
            quantity: m.quantity,
            itemTotal: m.itemTotal,
          })) as unknown as Prisma.InputJsonValue,
          totalAmount: Number(total.toFixed(2)),
          deliveryFee,
          address: deliveryAddress,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          // Carrying the prescription is what lets the pharmacy dispatch
          // prescription-only items at all.
          prescriptionId: fulfilment.prescriptionId,
          fulfilmentId: fulfilment.id,
          // Held until paid. Partner queues filter this status out.
          status: 'PENDING_PAYMENT',
        },
      });
      created.medicineOrderId = order.id;

      /**
       * Hold the stock now rather than at payment.
       *
       * Payment normally follows consent within seconds, and reserving here is
       * what stops two patients being promised the last box in that window.
       * Best-effort: the basket was priced against stock that existed, so a
       * failure here means it moved in the meantime — the order still stands
       * and the pharmacy can cancel it with a reason, which is better than
       * discarding a consent the patient already gave.
       */
      if (pharmacyId) {
        const held = await reserveStockForOrder(
          pharmacyId,
          chosenMedicines.map((m) => ({ medicineId: m.medicineId, quantity: m.quantity }))
        );
        if (!held.reserved) {
          logger.warn(`[fulfilment] could not reserve stock for order ${order.id}: ${held.shortfall}`);
        }
      }
    }

    for (const test of chosenTests) {
      const labOrder = await prisma.labOrder.create({
        data: {
          patientId: input.patientId,
          labPartnerId: test.labPartnerId,
          testName: test.testName,
          price: (test.price ?? 0) + test.homeCollectionFee,
          address: deliveryAddress,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          status: 'PENDING_PAYMENT',
          fulfilmentId: fulfilment.id,
        },
      });
      created.labOrderIds.push(labOrder.id);
    }
  } catch (err) {
    // Never strand a fulfilment as consented with no orders behind it.
    await prisma.prescriptionFulfilment
      .updateMany({
        where: { id: fulfilment.id },
        data: { status: 'PENDING_CONSENT', consentedAt: null },
      })
      .catch(() => undefined);
    throw err;
  }

  await recordAudit({
    actorUserId: fulfilment.patient.userId,
    action: 'fulfilment.consented',
    entityType: 'PrescriptionFulfilment',
    entityId: fulfilment.id,
    metadata: {
      medicineOrderId: created.medicineOrderId ?? null,
      labOrderIds: created.labOrderIds,
      medicineCount: chosenMedicines.length,
      testCount: chosenTests.length,
      paymentMethod: input.paymentMethod,
    },
    ipAddress: input.ipAddress ?? null,
  });

  /**
   * Opening the checkout is the last step, and a failure here must not undo the
   * consent: the orders exist and are held, so the patient can simply retry
   * payment. Rolling the whole thing back would make them re-approve a
   * prescription they already approved.
   */
  let checkout: Awaited<ReturnType<typeof createCheckoutService>> | null = null;
  try {
    checkout = await createCheckoutService({
      userId: input.userId,
      patientId: input.patientId,
      purpose: 'PRESCRIPTION_BASKET',
      targetId: fulfilment.id,
      method: input.paymentMethod,
      ipAddress: input.ipAddress ?? null,
    });
  } catch (err) {
    logger.error(`[fulfilment] checkout could not be opened for ${fulfilment.id}`, err);
  }

  return {
    fulfilmentId: fulfilment.id,
    medicineOrderId: created.medicineOrderId ?? null,
    labOrderIds: created.labOrderIds,
    checkout,
    message: checkout
      ? checkout.message
      : 'Your order is saved but payment could not be started. Open it from your orders to pay.',
  };
};

export const declineFulfilmentService = async (
  fulfilmentId: string,
  patientId: string,
  reason?: string
) => {
  const declined = await prisma.prescriptionFulfilment.updateMany({
    where: { id: fulfilmentId, patientId, status: 'PENDING_CONSENT' },
    data: { status: 'DECLINED', declinedAt: new Date(), declineReason: reason?.trim() || null },
  });

  if (declined.count === 0) {
    throw notFound('Prescription order');
  }
  return { id: fulfilmentId, status: 'DECLINED' as const };
};

/** Lapses stale offers. Safe to run repeatedly; call from a scheduled job. */
export const expireStaleFulfilmentsService = async () => {
  const result = await prisma.prescriptionFulfilment.updateMany({
    where: { status: 'PENDING_CONSENT', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  if (result.count > 0) logger.info(`[fulfilment] expired ${result.count} unanswered offer(s)`);
  return { expired: result.count };
};

/**
 * Re-quotes a prescription whose offer has lapsed.
 *
 * A prescription stays clinically valid for far longer than a price does. The
 * basket expires so nobody is charged a figure they were quoted weeks ago — but
 * that expiry used to be a dead end, sending the patient back to the doctor for
 * something that needs no clinical decision at all. Re-pricing the same drugs
 * is arithmetic, so the patient can ask for it themselves.
 *
 * What is deliberately *not* re-decided: which drugs. Those come from the
 * prescription and are untouched. Only availability and price are recomputed,
 * which is why this cannot be used to obtain anything the doctor did not write.
 */
export const requoteFulfilmentService = async (prescriptionId: string, patientId: string) => {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    select: { id: true, patientId: true, fulfilment: { select: { id: true, status: true } } },
  });

  // 404 rather than 403 so prescription ids cannot be probed across patients.
  if (!prescription || prescription.patientId !== patientId) throw notFound('Prescription');

  const existing = prescription.fulfilment;

  if (existing?.status === 'CONSENTED') {
    throw conflict('You have already ordered this prescription.');
  }
  if (existing?.status === 'PENDING_CONSENT') {
    // Still live — hand back what is already on offer rather than silently
    // rebuilding it at a different price under the patient's feet.
    return getFulfilmentService(existing.id, patientId);
  }

  // Only a lapsed or declined offer is replaced, and neither has orders hanging
  // off it — a consented one would, which is why that case is refused above.
  if (existing) {
    await prisma.prescriptionFulfilment.delete({ where: { id: existing.id } });
  }

  await createFulfilmentForPrescription(prescriptionId);

  const fresh = await prisma.prescriptionFulfilment.findUnique({
    where: { prescriptionId },
    select: { id: true },
  });
  if (!fresh) {
    throw new AppError('Nothing in this prescription can be ordered right now.', 409);
  }

  return getFulfilmentService(fresh.id, patientId);
};
