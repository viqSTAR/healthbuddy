import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { recordAudit } from './auditService.js';
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

/** Cheapest active lab offering the test. */
const quoteLabTest = async (labPackageId: string) => {
  const offer = await prisma.labOffering.findFirst({
    where: { labPackageId, isActive: true, labPartner: { isActive: true } },
    orderBy: { price: 'asc' },
    select: {
      price: true,
      homeCollectionFee: true,
      labPartner: { select: { id: true, name: true } },
    },
  });

  if (!offer) return null;
  return {
    price: offer.price,
    homeCollectionFee: offer.homeCollectionFee,
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
  /** Lets the patient drop items they already have. Empty means "everything". */
  acceptMedicineIds?: string[];
  acceptLabPackageIds?: string[];
  deliveryAddress: string;
  latitude?: number;
  longitude?: number;
  ipAddress?: string | null;
}

/**
 * The consent action. Creates the real orders.
 *
 * Prices come from the stored quote, never from the request — the patient is
 * charged exactly what they were shown. The status transition is a conditional
 * update so a double-tap cannot produce two sets of orders.
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
    throw conflict('This order was declined. Ask your doctor to reissue it.');
  }
  if (fulfilment.expiresAt < new Date()) {
    await prisma.prescriptionFulfilment.updateMany({
      where: { id: fulfilment.id, status: 'PENDING_CONSENT' },
      data: { status: 'EXPIRED' },
    });
    throw new AppError('This offer has expired. Ask your doctor to reissue it.', 410);
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
          address: input.deliveryAddress,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          // Carrying the prescription is what lets the pharmacy dispatch
          // prescription-only items at all.
          prescriptionId: fulfilment.prescriptionId,
          fulfilmentId: fulfilment.id,
        },
      });
      created.medicineOrderId = order.id;
    }

    for (const test of chosenTests) {
      const labOrder = await prisma.labOrder.create({
        data: {
          patientId: input.patientId,
          labPartnerId: test.labPartnerId,
          testName: test.testName,
          price: (test.price ?? 0) + test.homeCollectionFee,
          address: input.deliveryAddress,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          status: test.labPartnerId ? 'ACCEPTED' : 'BOOKED',
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
    },
    ipAddress: input.ipAddress ?? null,
  });

  await notifyPartners(created);

  return {
    fulfilmentId: fulfilment.id,
    medicineOrderId: created.medicineOrderId ?? null,
    labOrderIds: created.labOrderIds,
    message: 'Order placed. You can track it from your orders.',
  };
};

/** Tells the assigned pharmacy and labs that work has arrived. */
const notifyPartners = async (created: { medicineOrderId?: string; labOrderIds: string[] }) => {
  if (created.medicineOrderId) {
    const order = await prisma.medicineOrder.findUnique({
      where: { id: created.medicineOrderId },
      select: { pharmacy: { select: { userId: true } } },
    });
    if (order?.pharmacy) {
      await notify({
        userId: order.pharmacy.userId,
        type: 'ORDER_PLACED',
        title: 'New prescription order',
        body: 'A patient approved a prescription. The order is in your queue.',
        data: { orderId: created.medicineOrderId },
        appId: 'PARTNER',
      });
    }
  }

  for (const labOrderId of created.labOrderIds) {
    const order = await prisma.labOrder.findUnique({
      where: { id: labOrderId },
      select: { testName: true, labPartner: { select: { userId: true } } },
    });
    if (order?.labPartner) {
      await notify({
        userId: order.labPartner.userId,
        type: 'LAB_BOOKED',
        title: 'New test booking',
        body: `${order.testName} was booked from a prescription.`,
        data: { labOrderId },
        appId: 'PARTNER',
      });
    }
  }
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
