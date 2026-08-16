import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/db.js';
import { toNum, dec } from '../utils/money.js';
import { AppError, notFound } from '../utils/AppError.js';
import { recordAudit } from './auditService.js';

/**
 * Everything the admin panel reads and writes, organised by the thing being
 * administered rather than by the table it lives in.
 *
 * Two rules run through the whole file:
 *
 *   1. An admin observes freely and intervenes narrowly. Listing and drilling
 *      into any record is fine — that is the job. But an admin cannot invent
 *      state a participant never agreed to: they cannot mark an order paid,
 *      cannot write a prescription, cannot settle a payout. The mutations here
 *      are limited to the ones a support desk genuinely needs, and each one is
 *      audited with the actor and a reason.
 *
 *   2. Nothing here reads a patient's clinical detail into a list. Diagnoses
 *      and prescription contents are PHI; the panel shows that a consultation
 *      happened and who was in it, which is what operating the platform needs.
 */

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

interface Page {
  page: number;
  limit: number;
}

const skipTake = ({ page, limit }: Page) => ({ skip: (page - 1) * limit, take: limit });

/** Rounds for display, and accepts the Decimal that money columns now return. */
const money = (n: Prisma.Decimal | number | null | undefined) => Number(toNum(n).toFixed(2));

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

/**
 * A free-text search box has to work on a phone number as readily as a name,
 * because that is the only identifier a caller to a support desk has.
 */
const contains = (term: string) => ({ contains: term, mode: 'insensitive' as const });

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

/**
 * The landing page. Deliberately grouped into "what needs a human", "who is on
 * the platform" and "what moved today" — a wall of undifferentiated counters
 * tells an operator nothing about where to start.
 */
export const getAdminOverviewService = async () => {
  const today = startOfToday();
  const month = startOfMonth();
  const week = daysAgo(7);

  const [
    patients,
    doctors,
    pharmacies,
    labs,
    suspended,
    pendingApplications,
    activeEmergencies,
    unpaidOrders,
    ordersAwaitingPharmacy,
    ordersInDelivery,
    labOrdersOpen,
    appointmentsToday,
    consultsInProgress,
    consultsThisMonth,
    signupsThisWeek,
    paidThisMonth,
    codOutstanding,
    refundedThisMonth,
    unsettledSplits,
    failedWebhooks,
    lowStock,
    expiringStock,
    expiringLicences,
    staleFulfilments,
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.doctor.count(),
    prisma.pharmacy.count(),
    prisma.labPartner.count(),
    prisma.user.count({ where: { isSuspended: true } }),
    prisma.providerApplication.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
    prisma.emergencySOS.count({ where: { status: { notIn: ['RESOLVED', 'CANCELLED'] } } }),
    // Sitting unpaid for over an hour: the checkout was abandoned.
    prisma.medicineOrder.count({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: daysAgo(1 / 24) } },
    }),
    prisma.medicineOrder.count({ where: { status: 'PLACED' } }),
    prisma.medicineOrder.count({ where: { status: { in: ['PROCESSING', 'DISPATCHED'] } } }),
    prisma.labOrder.count({
      where: { status: { in: ['BOOKED', 'ACCEPTED', 'SAMPLE_COLLECTED', 'PROCESSING'] } },
    }),
    prisma.appointment.count({ where: { createdAt: { gte: today } } }),
    prisma.appointment.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.appointment.count({ where: { status: 'COMPLETED', updatedAt: { gte: month } } }),
    prisma.user.count({ where: { createdAt: { gte: week } } }),
    prisma.payment.aggregate({
      _sum: { amount: true, platformFee: true },
      _count: true,
      where: { status: 'PAID', paidAt: { gte: month } },
    }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { status: 'PENDING', method: 'COD' },
    }),
    prisma.payment.aggregate({
      _sum: { refundedAmount: true },
      where: { refundedAt: { gte: month } },
    }),
    prisma.paymentSplit.aggregate({ _sum: { amount: true }, _count: true, where: { status: 'PENDING' } }),
    prisma.paymentWebhookEvent.count({ where: { processedAt: null } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "PharmacyInventory"
      WHERE "isActive" = true AND ("stock" - "reserved") <= "reorderLevel"
    `,
    prisma.pharmacyInventory.count({
      where: { stock: { gt: 0 }, expiryDate: { not: null, lte: daysAhead(60) } },
    }),
    Promise.all([
      prisma.pharmacy.count({ where: { drugLicenceExpiry: { not: null, lte: daysAhead(60) } } }),
      prisma.labPartner.count({ where: { nablExpiry: { not: null, lte: daysAhead(60) } } }),
    ]),
    prisma.prescriptionFulfilment.count({
      where: { status: 'PENDING_CONSENT', expiresAt: { lt: new Date() } },
    }),
  ]);

  const grossPaid = money(paidThisMonth._sum.amount);
  const platformCut = money(paidThisMonth._sum.platformFee);

  return {
    /** Things an operator should look at now, most urgent first. */
    attention: {
      activeEmergencies,
      pendingApplications,
      failedWebhooks,
      expiringLicences: expiringLicences[0] + expiringLicences[1],
      expiredFulfilments: staleFulfilments,
      abandonedCheckouts: unpaidOrders,
      lowStockLines: Number(lowStock[0]?.count ?? 0),
      expiringStockLines: expiringStock,
    },
    people: {
      patients,
      doctors,
      pharmacies,
      labs,
      suspended,
      signupsThisWeek,
    },
    operations: {
      appointmentsToday,
      consultsInProgress,
      consultsThisMonth,
      ordersAwaitingPharmacy,
      ordersInDelivery,
      labOrdersOpen,
    },
    money: {
      grossPaidThisMonth: grossPaid,
      platformFeeThisMonth: platformCut,
      /** What partners are owed out of this month's takings. */
      partnerShareThisMonth: money(grossPaid - platformCut),
      paidCountThisMonth: paidThisMonth._count,
      codOutstanding: money(codOutstanding._sum.amount),
      codOutstandingCount: codOutstanding._count,
      refundedThisMonth: money(refundedThisMonth._sum.refundedAmount),
      unsettledSplitAmount: money(unsettledSplits._sum.amount),
      unsettledSplitCount: unsettledSplits._count,
    },
    generatedAt: new Date().toISOString(),
  };
};

/* ------------------------------------------------------------------ *
 * Patients
 * ------------------------------------------------------------------ */

export const listPatientsService = async (params: Page & { search?: string }) => {
  const where: Prisma.PatientWhereInput = params.search
    ? {
        OR: [
          { fullName: contains(params.search) },
          { email: contains(params.search) },
          { user: { phoneNumber: contains(params.search) } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        fullName: true,
        age: true,
        gender: true,
        bloodGroup: true,
        address: true,
        createdAt: true,
        user: { select: { id: true, phoneNumber: true, isSuspended: true, createdAt: true } },
        _count: { select: { appointments: true, medicineOrders: true, labOrders: true } },
      },
    }),
  ]);

  return { patients: rows, total, page: params.page, limit: params.limit };
};

/**
 * One patient, everything about them that operating the platform requires.
 *
 * Note what is absent: no diagnosis, no prescribed drugs, no lab results. A
 * support agent resolving "my order never arrived" has no business reading why
 * the patient saw a doctor, and building the screen without those fields is the
 * only reliable way to keep them out of it.
 */
export const getPatientService = async (id: string) => {
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          phoneNumber: true,
          role: true,
          isSuspended: true,
          isVerified: true,
          createdAt: true,
        },
      },
    },
  });
  if (!patient) throw notFound('Patient');

  const [appointments, medicineOrders, labOrders, payments, emergencies] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        startedAt: true,
        endedAt: true,
        doctor: { select: { id: true, name: true, specialty: true } },
        slot: { select: { date: true, startTime: true } },
      },
    }),
    prisma.medicineOrder.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        deliveryFee: true,
        createdAt: true,
        deliveredAt: true,
        pharmacy: { select: { id: true, name: true } },
      },
    }),
    prisma.labOrder.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        testName: true,
        status: true,
        price: true,
        createdAt: true,
        completedAt: true,
        labPartner: { select: { id: true, name: true } },
      },
    }),
    prisma.payment.findMany({
      where: { userId: patient.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        purpose: true,
        method: true,
        amount: true,
        status: true,
        refundedAmount: true,
        paidAt: true,
        createdAt: true,
      },
    }),
    prisma.emergencySOS.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, status: true, note: true, createdAt: true, resolvedAt: true },
    }),
  ]);

  const lifetime = toNum(
    payments
      .filter((p) => p.status === 'PAID')
      .reduce((total, p) => total.add(p.amount).sub(p.refundedAmount), dec(0))
  );

  return {
    patient,
    appointments,
    medicineOrders,
    labOrders,
    payments,
    emergencies,
    totals: { lifetimeValue: money(lifetime) },
  };
};

/* ------------------------------------------------------------------ *
 * Doctors
 * ------------------------------------------------------------------ */

export const listDoctorsService = async (
  params: Page & { search?: string; specialty?: string; state?: 'AVAILABLE' | 'OFFLINE' | 'SUSPENDED' | 'UNVERIFIED' }
) => {
  const where: Prisma.DoctorWhereInput = {
    ...(params.search
      ? {
          OR: [
            { name: contains(params.search) },
            { specialty: contains(params.search) },
            { councilRegistrationNumber: contains(params.search) },
            { user: { phoneNumber: contains(params.search) } },
          ],
        }
      : {}),
    ...(params.specialty ? { specialty: contains(params.specialty) } : {}),
    ...(params.state === 'AVAILABLE' ? { isAvailable: true, user: { isSuspended: false } } : {}),
    ...(params.state === 'OFFLINE' ? { isAvailable: false } : {}),
    ...(params.state === 'SUSPENDED' ? { user: { isSuspended: true } } : {}),
    ...(params.state === 'UNVERIFIED' ? { verifiedAt: null } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.doctor.count({ where }),
    prisma.doctor.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        name: true,
        specialty: true,
        qualification: true,
        experienceYears: true,
        consultationFee: true,
        commissionPercent: true,
        rating: true,
        isAvailable: true,
        verifiedAt: true,
        councilRegistrationNumber: true,
        payoutAccountId: true,
        createdAt: true,
        user: { select: { id: true, phoneNumber: true, isSuspended: true } },
        _count: { select: { appointments: true, prescriptions: true, slots: true } },
      },
    }),
  ]);

  return { doctors: rows, total, page: params.page, limit: params.limit };
};

export const getDoctorService = async (id: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, phoneNumber: true, isSuspended: true, isVerified: true, createdAt: true },
      },
    },
  });
  if (!doctor) throw notFound('Doctor');

  const [byStatus, upcomingSlots, recent, earnings, application] = await Promise.all([
    prisma.appointment.groupBy({
      by: ['status'],
      where: { doctorId: id },
      _count: { _all: true },
    }),
    // Slots are stored as YYYY-MM-DD plus HH:mm strings, so "upcoming" is a
    // lexicographic date comparison rather than a timestamp one.
    prisma.doctorSlot.count({
      where: { doctorId: id, date: { gte: new Date().toISOString().slice(0, 10) }, status: 'AVAILABLE' },
    }),
    prisma.appointment.findMany({
      where: { doctorId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        startedAt: true,
        endedAt: true,
        patient: { select: { id: true, fullName: true } },
        slot: { select: { date: true, startTime: true } },
      },
    }),
    prisma.paymentSplit.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { payeeType: 'DOCTOR', payeeId: id },
    }),
    prisma.providerApplication.findFirst({
      where: { userId: doctor.userId, type: 'DOCTOR' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, submittedAt: true, reviewedAt: true },
    }),
  ]);

  return {
    doctor,
    application,
    upcomingSlots,
    appointmentsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    recentAppointments: recent,
    earnings: { total: money(earnings._sum.amount), legs: earnings._count },
  };
};

/**
 * The commercial terms of a doctor's listing.
 *
 * `verifiedAt` is settable because a council registration can be confirmed out
 * of band — a phone call to the council — after an application was approved on
 * documents alone. It is not settable to a *false* value by writing a date: the
 * caller sends a boolean and the timestamp is the platform's, not theirs.
 */
export const updateDoctorService = async (params: {
  actorUserId: string;
  id: string;
  patch: {
    isAvailable?: boolean;
    consultationFee?: number;
    commissionPercent?: number | null;
    verified?: boolean;
    payoutAccountId?: string | null;
  };
  reason?: string;
  ipAddress?: string | null;
}) => {
  const existing = await prisma.doctor.findUnique({
    where: { id: params.id },
    select: { id: true, isAvailable: true, consultationFee: true, commissionPercent: true, verifiedAt: true },
  });
  if (!existing) throw notFound('Doctor');

  const { verified, ...rest } = params.patch;
  const data: Prisma.DoctorUpdateInput = {
    ...rest,
    ...(verified === undefined ? {} : { verifiedAt: verified ? (existing.verifiedAt ?? new Date()) : null }),
  };

  if (Object.keys(data).length === 0) throw new AppError('Nothing to update.', 400);

  const doctor = await prisma.doctor.update({ where: { id: params.id }, data });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'admin.doctor.updated',
    entityType: 'Doctor',
    entityId: doctor.id,
    metadata: { patch: params.patch, reason: params.reason ?? null },
    ipAddress: params.ipAddress ?? null,
  });

  return doctor;
};

/* ------------------------------------------------------------------ *
 * Pharmacies
 * ------------------------------------------------------------------ */

export const listPharmaciesService = async (
  params: Page & { search?: string; state?: 'ACTIVE' | 'INACTIVE' | 'LICENCE_EXPIRING' | 'UNVERIFIED' }
) => {
  const where: Prisma.PharmacyWhereInput = {
    ...(params.search
      ? {
          OR: [
            { name: contains(params.search) },
            { city: contains(params.search) },
            { pincode: contains(params.search) },
            { drugLicenceNumber: contains(params.search) },
            { user: { phoneNumber: contains(params.search) } },
          ],
        }
      : {}),
    ...(params.state === 'ACTIVE' ? { isActive: true } : {}),
    ...(params.state === 'INACTIVE' ? { isActive: false } : {}),
    ...(params.state === 'UNVERIFIED' ? { verifiedAt: null } : {}),
    ...(params.state === 'LICENCE_EXPIRING'
      ? { drugLicenceExpiry: { not: null, lte: daysAhead(60) } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.pharmacy.count({ where }),
    prisma.pharmacy.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        pincode: true,
        address: true,
        isActive: true,
        verifiedAt: true,
        deliveryRadiusKm: true,
        commissionPercent: true,
        payoutAccountId: true,
        drugLicenceNumber: true,
        drugLicenceExpiry: true,
        gstin: true,
        createdAt: true,
        user: { select: { id: true, phoneNumber: true, isSuspended: true } },
        _count: { select: { orders: true, inventory: true } },
      },
    }),
  ]);

  return { pharmacies: rows, total, page: params.page, limit: params.limit };
};

export const getPharmacyService = async (id: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, phoneNumber: true, isSuspended: true, isVerified: true, createdAt: true },
      },
    },
  });
  if (!pharmacy) throw notFound('Pharmacy');

  const [byStatus, revenue, earnings, lowStock, expiring, recentOrders, writeOffs] = await Promise.all([
    prisma.medicineOrder.groupBy({
      by: ['status'],
      where: { pharmacyId: id },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.medicineOrder.aggregate({
      _sum: { totalAmount: true },
      where: { pharmacyId: id, status: 'DELIVERED' },
    }),
    prisma.paymentSplit.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { payeeType: 'PHARMACY', payeeId: id },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "PharmacyInventory"
      WHERE "pharmacyId" = ${id} AND "isActive" = true AND ("stock" - "reserved") <= "reorderLevel"
    `,
    prisma.pharmacyInventory.count({
      where: { pharmacyId: id, stock: { gt: 0 }, expiryDate: { not: null, lte: daysAhead(60) } },
    }),
    prisma.medicineOrder.findMany({
      where: { pharmacyId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        deliveredAt: true,
        patient: { select: { id: true, fullName: true } },
      },
    }),
    // Write-offs are the number a pharmacy has an incentive to under-report,
    // so they get their own line rather than being buried in the ledger.
    prisma.stockMovement.groupBy({
      by: ['reason'],
      where: { pharmacyId: id, reason: { in: ['EXPIRED', 'DAMAGED', 'CORRECTION', 'SALE_OFFLINE'] } },
      _count: { _all: true },
      _sum: { delta: true },
    }),
  ]);

  return {
    pharmacy,
    ordersByStatus: byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
      amount: money(r._sum.totalAmount),
    })),
    lifetimeRevenue: money(revenue._sum.totalAmount),
    earnings: { total: money(earnings._sum.amount), legs: earnings._count },
    inventory: { lowStockLines: Number(lowStock[0]?.count ?? 0), expiringLines: expiring },
    recentOrders,
    writeOffs: writeOffs.map((r) => ({ reason: r.reason, count: r._count._all, units: r._sum.delta ?? 0 })),
  };
};

export const updatePharmacyService = async (params: {
  actorUserId: string;
  id: string;
  patch: {
    isActive?: boolean;
    deliveryRadiusKm?: number;
    commissionPercent?: number | null;
    verified?: boolean;
    payoutAccountId?: string | null;
    drugLicenceNumber?: string | null;
    drugLicenceExpiry?: string | null;
  };
  reason?: string;
  ipAddress?: string | null;
}) => {
  const existing = await prisma.pharmacy.findUnique({
    where: { id: params.id },
    select: { id: true, verifiedAt: true },
  });
  if (!existing) throw notFound('Pharmacy');

  const { verified, drugLicenceExpiry, ...rest } = params.patch;
  const data: Prisma.PharmacyUpdateInput = {
    ...rest,
    ...(drugLicenceExpiry === undefined
      ? {}
      : { drugLicenceExpiry: drugLicenceExpiry ? new Date(drugLicenceExpiry) : null }),
    ...(verified === undefined ? {} : { verifiedAt: verified ? (existing.verifiedAt ?? new Date()) : null }),
  };

  if (Object.keys(data).length === 0) throw new AppError('Nothing to update.', 400);

  const pharmacy = await prisma.pharmacy.update({ where: { id: params.id }, data });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'admin.pharmacy.updated',
    entityType: 'Pharmacy',
    entityId: pharmacy.id,
    metadata: { patch: params.patch, reason: params.reason ?? null },
    ipAddress: params.ipAddress ?? null,
  });

  return pharmacy;
};

/** The shop's shelf, read-only here — stock only moves through the ledger. */
export const getPharmacyInventoryService = async (
  params: Page & { pharmacyId: string; search?: string; only?: 'LOW' | 'EXPIRING' | 'OUT' }
) => {
  const where: Prisma.PharmacyInventoryWhereInput = {
    pharmacyId: params.pharmacyId,
    ...(params.search ? { medicine: { name: contains(params.search) } } : {}),
    ...(params.only === 'OUT' ? { stock: { lte: 0 } } : {}),
    ...(params.only === 'EXPIRING'
      ? { stock: { gt: 0 }, expiryDate: { not: null, lte: daysAhead(60) } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.pharmacyInventory.count({ where }),
    prisma.pharmacyInventory.findMany({
      where,
      orderBy: { medicine: { name: 'asc' } },
      ...skipTake(params),
      select: {
        id: true,
        price: true,
        stock: true,
        reserved: true,
        reorderLevel: true,
        isActive: true,
        batchNumber: true,
        expiryDate: true,
        updatedAt: true,
        medicine: {
          select: { id: true, name: true, category: true, schedule: true, requiresPrescription: true },
        },
      },
    }),
  ]);

  // "Low" compares sellable stock against the reorder level, which Prisma
  // cannot express as a filter on two columns — so it is applied after the read.
  const lines = rows.map((r) => ({ ...r, available: r.stock - r.reserved }));
  const filtered = params.only === 'LOW' ? lines.filter((l) => l.available <= l.reorderLevel) : lines;

  return { lines: filtered, total, page: params.page, limit: params.limit };
};

/* ------------------------------------------------------------------ *
 * Labs
 * ------------------------------------------------------------------ */

export const listLabsService = async (
  params: Page & { search?: string; state?: 'ACTIVE' | 'INACTIVE' | 'NABL' | 'UNVERIFIED' }
) => {
  const where: Prisma.LabPartnerWhereInput = {
    ...(params.search
      ? {
          OR: [
            { name: contains(params.search) },
            { city: contains(params.search) },
            { location: contains(params.search) },
            { labRegistrationNumber: contains(params.search) },
            { user: { phoneNumber: contains(params.search) } },
          ],
        }
      : {}),
    ...(params.state === 'ACTIVE' ? { isActive: true } : {}),
    ...(params.state === 'INACTIVE' ? { isActive: false } : {}),
    ...(params.state === 'NABL' ? { nablAccredited: true } : {}),
    ...(params.state === 'UNVERIFIED' ? { verifiedAt: null } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.labPartner.count({ where }),
    prisma.labPartner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        name: true,
        location: true,
        city: true,
        state: true,
        pincode: true,
        isActive: true,
        verifiedAt: true,
        homeCollection: true,
        nablAccredited: true,
        nablCertNumber: true,
        nablExpiry: true,
        labRegistrationNumber: true,
        commissionPercent: true,
        payoutAccountId: true,
        createdAt: true,
        user: { select: { id: true, phoneNumber: true, isSuspended: true } },
        _count: { select: { labOrders: true, offerings: true } },
      },
    }),
  ]);

  return { labs: rows, total, page: params.page, limit: params.limit };
};

export const getLabService = async (id: string) => {
  const lab = await prisma.labPartner.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, phoneNumber: true, isSuspended: true, isVerified: true, createdAt: true },
      },
    },
  });
  if (!lab) throw notFound('Lab');

  const [byStatus, revenue, earnings, offerings, recentOrders] = await Promise.all([
    prisma.labOrder.groupBy({
      by: ['status'],
      where: { labPartnerId: id },
      _count: { _all: true },
      _sum: { price: true },
    }),
    prisma.labOrder.aggregate({
      _sum: { price: true },
      where: { labPartnerId: id, status: 'COMPLETED' },
    }),
    prisma.paymentSplit.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { payeeType: 'LAB', payeeId: id },
    }),
    prisma.labOffering.findMany({
      where: { labPartnerId: id },
      orderBy: { labPackage: { testName: 'asc' } },
      select: {
        id: true,
        turnaroundHours: true,
        isActive: true,
        updatedAt: true,
        labPackage: { select: { id: true, testName: true, category: true, price: true, sampleType: true } },
      },
    }),
    prisma.labOrder.findMany({
      where: { labPartnerId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        testName: true,
        status: true,
        price: true,
        createdAt: true,
        completedAt: true,
        patient: { select: { id: true, fullName: true } },
      },
    }),
  ]);

  return {
    lab,
    ordersByStatus: byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
      amount: money(r._sum.price),
    })),
    lifetimeRevenue: money(revenue._sum.price),
    earnings: { total: money(earnings._sum.amount), legs: earnings._count },
    offerings,
    recentOrders,
  };
};

export const updateLabService = async (params: {
  actorUserId: string;
  id: string;
  patch: {
    isActive?: boolean;
    homeCollection?: boolean;
    commissionPercent?: number | null;
    verified?: boolean;
    payoutAccountId?: string | null;
    nablAccredited?: boolean;
    nablCertNumber?: string | null;
    nablExpiry?: string | null;
  };
  reason?: string;
  ipAddress?: string | null;
}) => {
  const existing = await prisma.labPartner.findUnique({
    where: { id: params.id },
    select: { id: true, verifiedAt: true },
  });
  if (!existing) throw notFound('Lab');

  const { verified, nablExpiry, ...rest } = params.patch;
  const data: Prisma.LabPartnerUpdateInput = {
    ...rest,
    ...(nablExpiry === undefined ? {} : { nablExpiry: nablExpiry ? new Date(nablExpiry) : null }),
    ...(verified === undefined ? {} : { verifiedAt: verified ? (existing.verifiedAt ?? new Date()) : null }),
  };

  if (Object.keys(data).length === 0) throw new AppError('Nothing to update.', 400);

  const lab = await prisma.labPartner.update({ where: { id: params.id }, data });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'admin.lab.updated',
    entityType: 'LabPartner',
    entityId: lab.id,
    metadata: { patch: params.patch, reason: params.reason ?? null },
    ipAddress: params.ipAddress ?? null,
  });

  return lab;
};

/**
 * Turns a lab's capability on or off.
 *
 * The admin can suspend an offering — a machine reported down, an accreditation
 * lapsed for one discipline — but cannot price it. Price belongs to LabTestPrice
 * and is uniform per area by design.
 */
export const setLabOfferingActiveService = async (params: {
  actorUserId: string;
  offeringId: string;
  isActive: boolean;
  reason?: string;
  ipAddress?: string | null;
}) => {
  const offering = await prisma.labOffering.findUnique({
    where: { id: params.offeringId },
    select: { id: true, labPartnerId: true, labPackageId: true },
  });
  if (!offering) throw notFound('Lab offering');

  const updated = await prisma.labOffering.update({
    where: { id: params.offeringId },
    data: { isActive: params.isActive },
  });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: params.isActive ? 'admin.labOffering.enabled' : 'admin.labOffering.disabled',
    entityType: 'LabOffering',
    entityId: offering.id,
    metadata: {
      labPartnerId: offering.labPartnerId,
      labPackageId: offering.labPackageId,
      reason: params.reason ?? null,
    },
    ipAddress: params.ipAddress ?? null,
  });

  return updated;
};

/* ------------------------------------------------------------------ *
 * Appointments
 * ------------------------------------------------------------------ */

export const listAppointmentsService = async (
  params: Page & {
    status?: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    type?: 'VIDEO' | 'IN_PERSON';
    doctorId?: string;
    patientId?: string;
    search?: string;
    from?: string;
    to?: string;
  }
) => {
  const where: Prisma.AppointmentWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.type ? { type: params.type } : {}),
    ...(params.doctorId ? { doctorId: params.doctorId } : {}),
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.from || params.to
      ? {
          createdAt: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(params.to) } : {}),
          },
        }
      : {}),
    ...(params.search
      ? {
          OR: [
            { patient: { fullName: contains(params.search) } },
            { doctor: { name: contains(params.search) } },
            { patient: { user: { phoneNumber: contains(params.search) } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        type: true,
        status: true,
        isFollowUp: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        // Whether a room was ever minted, not the room id — that id is a bearer
        // credential and printing it in a list hands out call access.
        meetingProvider: true,
        patient: {
          select: { id: true, fullName: true, user: { select: { phoneNumber: true } } },
        },
        doctor: { select: { id: true, name: true, specialty: true, consultationFee: true } },
        slot: { select: { date: true, startTime: true, endTime: true } },
        payment: { select: { id: true, status: true, amount: true, method: true } },
        prescription: { select: { id: true, createdAt: true } },
      },
    }),
  ]);

  return {
    appointments: rows.map(({ meetingProvider, ...rest }) => ({
      ...rest,
      hasRoom: meetingProvider !== null,
    })),
    total,
    page: params.page,
    limit: params.limit,
  };
};

/* ------------------------------------------------------------------ *
 * Medicine orders
 * ------------------------------------------------------------------ */

const ORDER_LIST_SELECT = {
  id: true,
  status: true,
  totalAmount: true,
  deliveryFee: true,
  address: true,
  createdAt: true,
  acceptedAt: true,
  dispatchedAt: true,
  deliveredAt: true,
  cancelReason: true,
  patient: { select: { id: true, fullName: true, user: { select: { phoneNumber: true } } } },
  pharmacy: { select: { id: true, name: true, city: true } },
  assignedAgent: { select: { id: true, phoneNumber: true, role: true } },
  payment: { select: { id: true, status: true, method: true, amount: true, paidAt: true } },
  fulfilment: {
    select: { id: true, payment: { select: { id: true, status: true, method: true, amount: true, paidAt: true } } },
  },
} satisfies Prisma.MedicineOrderSelect;

/**
 * A basket paid for as one prescription fulfilment links its payment to the
 * fulfilment, not to each order. Reading only `order.payment` shows those as
 * unpaid, which is how a real support desk ends up chasing a customer who has
 * already paid.
 */
const flattenOrderPayment = <T extends { payment: unknown; fulfilment: { payment: unknown } | null }>(
  order: T
) => {
  const { fulfilment, ...rest } = order;
  return { ...rest, payment: order.payment ?? fulfilment?.payment ?? null };
};

export const listMedicineOrdersService = async (
  params: Page & {
    status?: string;
    pharmacyId?: string;
    patientId?: string;
    unassigned?: boolean;
    search?: string;
  }
) => {
  const where: Prisma.MedicineOrderWhereInput = {
    ...(params.status ? { status: params.status as Prisma.EnumOrderStatusFilter['equals'] } : {}),
    ...(params.pharmacyId ? { pharmacyId: params.pharmacyId } : {}),
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.unassigned ? { assignedAgentUserId: null } : {}),
    ...(params.search
      ? {
          OR: [
            { id: contains(params.search) },
            { address: contains(params.search) },
            { patient: { fullName: contains(params.search) } },
            { patient: { user: { phoneNumber: contains(params.search) } } },
            { pharmacy: { name: contains(params.search) } },
          ],
        }
      : {}),
  };

  const [total, rows, totals] = await Promise.all([
    prisma.medicineOrder.count({ where }),
    prisma.medicineOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: ORDER_LIST_SELECT,
    }),
    prisma.medicineOrder.aggregate({ _sum: { totalAmount: true }, where }),
  ]);

  return {
    orders: rows.map(flattenOrderPayment),
    total,
    matchedValue: money(totals._sum.totalAmount),
    page: params.page,
    limit: params.limit,
  };
};

export const getMedicineOrderService = async (id: string) => {
  const order = await prisma.medicineOrder.findUnique({
    where: { id },
    select: {
      ...ORDER_LIST_SELECT,
      items: true,
      latitude: true,
      longitude: true,
      prescriptionId: true,
      updatedAt: true,
      payment: {
        select: {
          id: true,
          status: true,
          method: true,
          amount: true,
          platformFee: true,
          paidAt: true,
          refundedAmount: true,
          refundReason: true,
          gateway: true,
          splits: {
            select: { id: true, payeeType: true, payeeId: true, amount: true, status: true, settledAt: true },
          },
        },
      },
    },
  });
  if (!order) throw notFound('Order');

  const movements = await prisma.stockMovement.findMany({
    where: { medicineOrderId: id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      delta: true,
      reason: true,
      balanceAfter: true,
      medicineId: true,
      createdAt: true,
    },
  });

  return { order, stockMovements: movements };
};

/**
 * Cancels an order on the customer's behalf.
 *
 * Delegates to the pharmacy's own cancel path rather than writing the status
 * directly. That path already releases the reservation, refunds through the
 * gateway and notifies the patient — reimplementing it here would mean an
 * admin cancellation quietly behaves differently from a partner one, which is
 * exactly the sort of divergence that shows up months later as "the money never
 * came back". The only thing added is the audit line naming the admin.
 */
export const cancelMedicineOrderService = async (params: {
  actorUserId: string;
  id: string;
  reason: string;
  ipAddress?: string | null;
}) => {
  const order = await prisma.medicineOrder.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, pharmacyId: true, totalAmount: true },
  });
  if (!order) throw notFound('Order');

  if (order.status === 'DELIVERED') {
    throw new AppError('This order was already delivered. Raise a refund instead of cancelling.', 409);
  }
  if (order.status === 'CANCELLED') throw new AppError('This order is already cancelled.', 409);
  if (!order.pharmacyId) {
    // No shop ever picked it up, so there is no reservation and no partner to
    // notify — the plain write is the whole job.
    const updated = await prisma.medicineOrder.update({
      where: { id: params.id },
      data: { status: 'CANCELLED', cancelReason: params.reason },
    });
    await recordAudit({
      actorUserId: params.actorUserId,
      action: 'admin.order.cancelled',
      entityType: 'MedicineOrder',
      entityId: order.id,
      metadata: { previousStatus: order.status, reason: params.reason, unassigned: true },
      ipAddress: params.ipAddress ?? null,
    });
    return updated;
  }

  const { updateOrderStatusService } = await import('./pharmacyService.js');
  const updated = await updateOrderStatusService(
    params.id,
    order.pharmacyId,
    'CANCELLED',
    params.reason
  );

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'admin.order.cancelled',
    entityType: 'MedicineOrder',
    entityId: order.id,
    metadata: { previousStatus: order.status, reason: params.reason, amount: order.totalAmount },
    ipAddress: params.ipAddress ?? null,
  });

  return updated;
};

/* ------------------------------------------------------------------ *
 * Lab orders
 * ------------------------------------------------------------------ */

export const listLabOrdersService = async (
  params: Page & {
    status?: string;
    labPartnerId?: string;
    patientId?: string;
    unassigned?: boolean;
    search?: string;
  }
) => {
  const where: Prisma.LabOrderWhereInput = {
    ...(params.status ? { status: params.status as Prisma.EnumLabOrderStatusFilter['equals'] } : {}),
    ...(params.labPartnerId ? { labPartnerId: params.labPartnerId } : {}),
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.unassigned ? { assignedAgentUserId: null } : {}),
    ...(params.search
      ? {
          OR: [
            { id: contains(params.search) },
            { testName: contains(params.search) },
            { patient: { fullName: contains(params.search) } },
            { patient: { user: { phoneNumber: contains(params.search) } } },
            { labPartner: { name: contains(params.search) } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.labOrder.count({ where }),
    prisma.labOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        testName: true,
        status: true,
        price: true,
        address: true,
        scheduledAt: true,
        collectedAt: true,
        completedAt: true,
        cancelReason: true,
        createdAt: true,
        patient: { select: { id: true, fullName: true, user: { select: { phoneNumber: true } } } },
        labPartner: { select: { id: true, name: true, city: true } },
        assignedAgent: { select: { id: true, phoneNumber: true, role: true } },
        payment: { select: { id: true, status: true, method: true, amount: true, paidAt: true } },
        fulfilment: {
          select: {
            id: true,
            payment: { select: { id: true, status: true, method: true, amount: true, paidAt: true } },
          },
        },
        _count: { select: { documents: true } },
      },
    }),
  ]);

  return {
    labOrders: rows.map(flattenOrderPayment),
    total,
    page: params.page,
    limit: params.limit,
  };
};

/* ------------------------------------------------------------------ *
 * Deliveries
 * ------------------------------------------------------------------ */

const DELIVERY_STAGES = ['PLACED', 'ACCEPTED', 'PROCESSING', 'DISPATCHED'] as const;

/**
 * The dispatch board: every order that has been paid for and not yet handed
 * over, with how long it has been sitting.
 *
 * There is no rider *identity* on this platform yet — `assignedAgentUserId`
 * points at whichever partner staff account picked the job up. So this board
 * tracks delivery WORK, not a rider roster, and the "agents" it lists are
 * derived from who is actually carrying orders rather than from a roster table
 * that does not exist. Building a real rider role means a registration flow, a
 * rider app, live location and COD reconciliation — a product, not a screen.
 */
export const getDeliveryBoardService = async (params: { pharmacyId?: string; agentUserId?: string }) => {
  const where: Prisma.MedicineOrderWhereInput = {
    status: { in: [...DELIVERY_STAGES] },
    ...(params.pharmacyId ? { pharmacyId: params.pharmacyId } : {}),
    ...(params.agentUserId ? { assignedAgentUserId: params.agentUserId } : {}),
  };

  const [orders, sampleRuns] = await Promise.all([
    prisma.medicineOrder.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: ORDER_LIST_SELECT,
    }),
    prisma.labOrder.findMany({
      where: {
        status: { in: ['BOOKED', 'ACCEPTED', 'SAMPLE_COLLECTED'] },
        ...(params.agentUserId ? { assignedAgentUserId: params.agentUserId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        testName: true,
        status: true,
        address: true,
        scheduledAt: true,
        createdAt: true,
        patient: { select: { id: true, fullName: true, user: { select: { phoneNumber: true } } } },
        labPartner: { select: { id: true, name: true } },
        assignedAgent: { select: { id: true, phoneNumber: true } },
      },
    }),
  ]);

  const now = Date.now();
  const withAge = orders.map((o) => {
    const flat = flattenOrderPayment(o);
    const since = (flat.dispatchedAt ?? flat.acceptedAt ?? flat.createdAt).getTime();
    return {
      ...flat,
      minutesInStage: Math.floor((now - since) / 60_000),
      /** Nobody has picked this up and it is past the point where someone should have. */
      stalled: flat.status === 'PLACED' && now - flat.createdAt.getTime() > 30 * 60_000,
    };
  });

  const lanes = Object.fromEntries(
    DELIVERY_STAGES.map((stage) => [stage, withAge.filter((o) => o.status === stage)])
  ) as Record<(typeof DELIVERY_STAGES)[number], typeof withAge>;

  // The agent roster, derived: who is currently carrying work, and how much.
  const byAgent = new Map<string, { id: string; phoneNumber: string; orders: number; oldestMinutes: number }>();
  for (const o of withAge) {
    if (!o.assignedAgent) continue;
    const row = byAgent.get(o.assignedAgent.id) ?? {
      id: o.assignedAgent.id,
      phoneNumber: o.assignedAgent.phoneNumber,
      orders: 0,
      oldestMinutes: 0,
    };
    row.orders += 1;
    row.oldestMinutes = Math.max(row.oldestMinutes, o.minutesInStage);
    byAgent.set(o.assignedAgent.id, row);
  }

  return {
    lanes,
    sampleRuns,
    agents: [...byAgent.values()].sort((a, b) => b.orders - a.orders),
    unassigned: withAge.filter((o) => !o.assignedAgent).length,
    stalled: withAge.filter((o) => o.stalled).length,
  };
};

/**
 * Hands an order to a specific rider, or takes it back.
 *
 * The field is a bare user id with no constraint in the schema, so the
 * constraint lives here. It used to admit any partner or admin account,
 * because there was no rider roster to check against; there is one now, and
 * an order handed to somebody who is not on it would show up in no app at all.
 * A patient account was always refused — a mistyped id silently routing an
 * order into a black hole is exactly the failure an ops tool should not
 * enable.
 */

export const assignDeliveryAgentService = async (params: {
  actorUserId: string;
  orderId: string;
  agentUserId: string | null;
  ipAddress?: string | null;
}) => {
  const order = await prisma.medicineOrder.findUnique({
    where: { id: params.orderId },
    select: { id: true, status: true, assignedAgentUserId: true },
  });
  if (!order) throw notFound('Order');
  if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
    throw new AppError('This order is closed and cannot be reassigned.', 409);
  }

  if (params.agentUserId) {
    const agent = await prisma.deliveryAgent.findUnique({
      where: { userId: params.agentUserId },
      select: { isActive: true, verifiedAt: true, user: { select: { isSuspended: true } } },
    });
    if (!agent) throw new AppError('That account is not a delivery agent.', 422);
    if (agent.user.isSuspended) throw new AppError('That account is suspended.', 409);
    if (!agent.isActive) throw new AppError('That agent is not active.', 422);
    if (!agent.verifiedAt) throw new AppError('That agent has not been verified yet.', 422);
  }

  const updated = await prisma.medicineOrder.update({
    where: { id: params.orderId },
    data: { assignedAgentUserId: params.agentUserId },
    select: ORDER_LIST_SELECT,
  });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: params.agentUserId ? 'admin.order.agentAssigned' : 'admin.order.agentCleared',
    entityType: 'MedicineOrder',
    entityId: order.id,
    metadata: { from: order.assignedAgentUserId, to: params.agentUserId },
    ipAddress: params.ipAddress ?? null,
  });

  return flattenOrderPayment(updated);
};

/**
 * Riders who may actually be handed a delivery, for the assignment picker.
 *
 * This used to list partner *staff* accounts, because there was no rider
 * roster to read — the workaround that `getDeliveryBoardService` describes.
 * There is one now, and assignment validates against it, so offering anything
 * else here would put names in the picker that the save then rejects.
 *
 * Unverified and inactive agents are excluded rather than shown greyed out:
 * this list exists to be picked from.
 */
export const listAssignableAgentsService = async (search?: string) => {
  const agents = await prisma.deliveryAgent.findMany({
    where: {
      isActive: true,
      verifiedAt: { not: null },
      user: { isSuspended: false },
      ...(search
        ? {
            OR: [
              { name: contains(search) },
              { vehicleNumber: contains(search) },
              { user: { phoneNumber: contains(search) } },
            ],
          }
        : {}),
    },
    // On shift first — a dispatcher wants whoever is working right now.
    orderBy: [{ isAvailable: 'desc' }, { name: 'asc' }],
    take: 100,
    select: {
      userId: true,
      name: true,
      vehicleNumber: true,
      isAvailable: true,
      labPartner: { select: { id: true, name: true } },
      user: {
        select: {
          phoneNumber: true,
          _count: { select: { assignedOrders: true, assignedLabOrders: true, assignedShipments: true } },
        },
      },
    },
  });

  return agents.map((a) => ({
    // The id an assignment actually stores is the USER id, not the agent id.
    id: a.userId,
    phoneNumber: a.user.phoneNumber,
    name: a.name,
    vehicleNumber: a.vehicleNumber,
    onShift: a.isAvailable,
    /** Set when this rider may also collect samples, and for which lab. */
    collectsFor: a.labPartner,
    openWork:
      a.user._count.assignedOrders +
      a.user._count.assignedLabOrders +
      a.user._count.assignedShipments,
  }));
};

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export const listPaymentsService = async (
  params: Page & {
    status?: string;
    purpose?: string;
    method?: string;
    search?: string;
    from?: string;
    to?: string;
  }
) => {
  const where: Prisma.PaymentWhereInput = {
    ...(params.status ? { status: params.status as Prisma.EnumPaymentStatusFilter['equals'] } : {}),
    ...(params.purpose ? { purpose: params.purpose as Prisma.EnumPaymentPurposeFilter['equals'] } : {}),
    ...(params.method ? { method: params.method as Prisma.EnumPaymentMethodFilter['equals'] } : {}),
    ...(params.from || params.to
      ? {
          createdAt: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(params.to) } : {}),
          },
        }
      : {}),
    ...(params.search
      ? {
          OR: [
            { id: contains(params.search) },
            { gatewayOrderId: contains(params.search) },
            { gatewayPaymentId: contains(params.search) },
            { user: { phoneNumber: contains(params.search) } },
          ],
        }
      : {}),
  };

  const [total, rows, paid, refunded] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        purpose: true,
        method: true,
        amount: true,
        platformFee: true,
        status: true,
        gateway: true,
        gatewayPaymentId: true,
        refundedAmount: true,
        paidAt: true,
        createdAt: true,
        user: { select: { id: true, phoneNumber: true, role: true } },
        _count: { select: { splits: true } },
      },
    }),
    prisma.payment.aggregate({ _sum: { amount: true, platformFee: true }, where: { ...where, status: 'PAID' } }),
    prisma.payment.aggregate({ _sum: { refundedAmount: true }, where }),
  ]);

  return {
    payments: rows,
    total,
    totals: {
      collected: money(paid._sum.amount),
      platformFee: money(paid._sum.platformFee),
      refunded: money(refunded._sum.refundedAmount),
    },
    page: params.page,
    limit: params.limit,
  };
};

/** One payment with the settlement legs that make it add up. */
export const getPaymentService = async (id: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, phoneNumber: true, role: true } },
      splits: { orderBy: { payeeType: 'asc' } },
      appointment: {
        select: {
          id: true,
          status: true,
          doctor: { select: { id: true, name: true } },
          patient: { select: { id: true, fullName: true } },
        },
      },
      medicineOrder: {
        select: { id: true, status: true, totalAmount: true, pharmacy: { select: { id: true, name: true } } },
      },
      labOrder: {
        select: { id: true, status: true, testName: true, labPartner: { select: { id: true, name: true } } },
      },
      fulfilment: {
        select: {
          id: true,
          status: true,
          medicineTotal: true,
          labTotal: true,
          deliveryFee: true,
          medicineOrders: { select: { id: true, status: true } },
          labOrders: { select: { id: true, status: true, testName: true } },
        },
      },
    },
  });
  if (!payment) throw notFound('Payment');

  // The reconciliation line: legs must add up to the charge, and a gap is a bug
  // worth seeing rather than a rounding difference worth hiding.
  const legTotal = payment.splits.reduce((total, s) => total.add(s.amount), dec(0));

  // Name each payee, so a split reads as "Apollo Pharmacy" not a bare uuid.
  const [pharmacies, labs, doctors] = await Promise.all([
    prisma.pharmacy.findMany({
      where: { id: { in: payment.splits.filter((s) => s.payeeType === 'PHARMACY').map((s) => s.payeeId ?? '') } },
      select: { id: true, name: true },
    }),
    prisma.labPartner.findMany({
      where: { id: { in: payment.splits.filter((s) => s.payeeType === 'LAB').map((s) => s.payeeId ?? '') } },
      select: { id: true, name: true },
    }),
    prisma.doctor.findMany({
      where: { id: { in: payment.splits.filter((s) => s.payeeType === 'DOCTOR').map((s) => s.payeeId ?? '') } },
      select: { id: true, name: true },
    }),
  ]);
  const names = new Map([...pharmacies, ...labs, ...doctors].map((r) => [r.id, r.name]));

  return {
    payment: {
      ...payment,
      splits: payment.splits.map((s) => ({
        ...s,
        payeeName: s.payeeType === 'PLATFORM' ? 'Health Buddy' : (names.get(s.payeeId ?? '') ?? null),
      })),
    },
    reconciliation: {
      charged: money(payment.amount),
      legTotal: money(legTotal),
      difference: money(dec(payment.amount).sub(legTotal)),
      /**
       * Exact. This compared floats within a penny, which meant a genuine
       * one-paise shortfall in a settlement looked identical to a rounding
       * artefact — and the whole point of this line is to catch the former.
       */
      balanced: dec(payment.amount).eq(legTotal),
    },
  };
};

/**
 * The gateway's delivery log.
 *
 * Unprocessed rows are the ones that matter: a webhook the platform accepted
 * but failed to act on means money moved at the gateway and did not move here.
 */
export const listWebhookEventsService = async (params: Page & { onlyFailed?: boolean }) => {
  const where: Prisma.PaymentWebhookEventWhereInput = params.onlyFailed
    ? { OR: [{ processedAt: null }, { error: { not: null } }] }
    : {};

  const [total, rows] = await Promise.all([
    prisma.paymentWebhookEvent.count({ where }),
    prisma.paymentWebhookEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(params),
      select: {
        id: true,
        gateway: true,
        eventId: true,
        eventType: true,
        processedAt: true,
        error: true,
        createdAt: true,
      },
    }),
  ]);

  return { events: rows, total, page: params.page, limit: params.limit };
};

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

export const listMedicinesService = async (
  params: Page & { search?: string; schedule?: string; category?: string }
) => {
  const where: Prisma.MedicineWhereInput = {
    ...(params.search
      ? {
          OR: [
            { name: contains(params.search) },
            { composition: contains(params.search) },
            { manufacturer: contains(params.search) },
          ],
        }
      : {}),
    ...(params.schedule ? { schedule: params.schedule as Prisma.EnumDrugScheduleFilter['equals'] } : {}),
    ...(params.category ? { category: contains(params.category) } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.medicine.count({ where }),
    prisma.medicine.findMany({
      where,
      orderBy: { name: 'asc' },
      ...skipTake(params),
      select: {
        id: true,
        name: true,
        category: true,
        price: true,
        composition: true,
        manufacturer: true,
        schedule: true,
        teleList: true,
        requiresPrescription: true,
        createdAt: true,
        _count: { select: { inventory: true } },
      },
    }),
  ]);

  return { medicines: rows, total, page: params.page, limit: params.limit };
};

/**
 * Catalogue maintenance.
 *
 * `schedule` and `teleList` are the two fields with legal weight: they decide
 * whether a drug may be sold online at all and whether a doctor may prescribe
 * it in a first consult. Changing them is audited with the old and new values,
 * because "who reclassified this as OTC" is a question that will eventually be
 * asked by someone who is not an engineer.
 */
export const upsertMedicineService = async (params: {
  actorUserId: string;
  id?: string;
  data: {
    name: string;
    category: string;
    price: number;
    composition?: string | null;
    manufacturer?: string | null;
    description?: string | null;
    schedule: 'OTC' | 'SCHEDULE_H' | 'SCHEDULE_H1' | 'SCHEDULE_X' | 'NARCOTIC';
    teleList: 'LIST_O' | 'LIST_A' | 'LIST_B' | 'PROHIBITED';
    requiresPrescription: boolean;
  };
  ipAddress?: string | null;
}) => {
  const before = params.id
    ? await prisma.medicine.findUnique({
        where: { id: params.id },
        select: { id: true, schedule: true, teleList: true, requiresPrescription: true, price: true },
      })
    : null;

  if (params.id && !before) throw notFound('Medicine');

  const medicine = params.id
    ? await prisma.medicine.update({ where: { id: params.id }, data: params.data })
    : await prisma.medicine.create({ data: params.data });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: params.id ? 'admin.medicine.updated' : 'admin.medicine.created',
    entityType: 'Medicine',
    entityId: medicine.id,
    metadata: {
      name: medicine.name,
      ...(before
        ? {
            was: {
              schedule: before.schedule,
              teleList: before.teleList,
              requiresPrescription: before.requiresPrescription,
              price: before.price,
            },
          }
        : {}),
      now: {
        schedule: medicine.schedule,
        teleList: medicine.teleList,
        requiresPrescription: medicine.requiresPrescription,
        price: medicine.price,
      },
    },
    ipAddress: params.ipAddress ?? null,
  });

  return medicine;
};

export const listLabPackagesAdminService = async (params: Page & { search?: string }) => {
  const where: Prisma.LabPackageWhereInput = params.search
    ? { OR: [{ testName: contains(params.search) }, { category: contains(params.search) }] }
    : {};

  const [total, rows] = await Promise.all([
    prisma.labPackage.count({ where }),
    prisma.labPackage.findMany({
      where,
      orderBy: { testName: 'asc' },
      ...skipTake(params),
      select: {
        id: true,
        testName: true,
        category: true,
        price: true,
        sampleType: true,
        fastingReq: true,
        description: true,
        _count: { select: { offerings: true, prices: true } },
      },
    }),
  ]);

  return { packages: rows, total, page: params.page, limit: params.limit };
};

export const upsertLabPackageService = async (params: {
  actorUserId: string;
  id?: string;
  data: {
    testName: string;
    category: string;
    price: number;
    sampleType: string;
    fastingReq: boolean;
    description?: string | null;
  };
  ipAddress?: string | null;
}) => {
  if (params.id) {
    const exists = await prisma.labPackage.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw notFound('Lab package');
  }

  const pkg = params.id
    ? await prisma.labPackage.update({ where: { id: params.id }, data: params.data })
    : await prisma.labPackage.create({ data: params.data });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: params.id ? 'admin.labPackage.updated' : 'admin.labPackage.created',
    entityType: 'LabPackage',
    entityId: pkg.id,
    metadata: { testName: pkg.testName, price: pkg.price },
    ipAddress: params.ipAddress ?? null,
  });

  return pkg;
};

/* ---------- Delivery agents ---------- */

/**
 * The rider roster.
 *
 * Agents sign themselves up, so this is the queue that decides whether any of
 * them ever sees a job: an unverified agent can read their own profile and
 * nothing else, because taking a job is what discloses a patient's address.
 * Without this screen the gate had no other side — somebody could register and
 * then wait forever.
 */
export const listAgentsService = async (
  params: Page & { search?: string; state?: 'UNVERIFIED' | 'ACTIVE' | 'INACTIVE' | 'ON_SHIFT' }
) => {
  const where: Prisma.DeliveryAgentWhereInput = {
    ...(params.search
      ? {
          OR: [
            { name: contains(params.search) },
            { vehicleNumber: contains(params.search) },
            { user: { phoneNumber: contains(params.search) } },
          ],
        }
      : {}),
    ...(params.state === 'UNVERIFIED' ? { verifiedAt: null } : {}),
    ...(params.state === 'ACTIVE' ? { isActive: true, verifiedAt: { not: null } } : {}),
    ...(params.state === 'INACTIVE' ? { isActive: false } : {}),
    ...(params.state === 'ON_SHIFT' ? { isAvailable: true } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.deliveryAgent.count({ where }),
    prisma.deliveryAgent.findMany({
      where,
      // Unverified first: this list is a work queue before it is a directory.
      orderBy: [{ verifiedAt: 'asc' }, { createdAt: 'desc' }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      select: {
        id: true,
        name: true,
        vehicleNumber: true,
        isActive: true,
        isAvailable: true,
        verifiedAt: true,
        createdAt: true,
        user: { select: { id: true, phoneNumber: true, isSuspended: true } },
        labPartner: { select: { id: true, name: true } },
        serviceAreas: { select: { pincode: true }, orderBy: { pincode: 'asc' } },
        _count: { select: { serviceAreas: true } },
      },
    }),
  ]);

  return {
    total,
    page: params.page,
    limit: params.limit,
    agents: rows.map(({ serviceAreas, _count, ...agent }) => ({
      ...agent,
      serviceAreas: serviceAreas.map((a) => a.pincode),
    })),
  };
};

/**
 * Verifying, suspending, and attaching a collector to a lab.
 *
 * `labPartnerId` is set here rather than by the agent, because it is the lab
 * vouching for someone who will draw blood in a patient's home — not a
 * preference the rider gets to tick.
 */
export const updateAgentService = async (params: {
  actorUserId: string;
  id: string;
  patch: { verified?: boolean; isActive?: boolean; labPartnerId?: string | null };
  reason?: string;
  ipAddress?: string | null;
}) => {
  const existing = await prisma.deliveryAgent.findUnique({
    where: { id: params.id },
    select: { id: true, verifiedAt: true },
  });
  if (!existing) throw notFound('Agent');

  const { verified, labPartnerId, ...rest } = params.patch;

  if (labPartnerId) {
    const lab = await prisma.labPartner.findUnique({
      where: { id: labPartnerId },
      select: { id: true },
    });
    if (!lab) throw new AppError('That lab does not exist.', 422);
  }

  const data: Prisma.DeliveryAgentUpdateInput = {
    ...rest,
    ...(labPartnerId === undefined
      ? {}
      : labPartnerId
        ? { labPartner: { connect: { id: labPartnerId } } }
        : { labPartner: { disconnect: true } }),
    ...(verified === undefined
      ? {}
      : { verifiedAt: verified ? (existing.verifiedAt ?? new Date()) : null }),
  };

  if (Object.keys(data).length === 0) throw new AppError('Nothing to update.', 400);

  /**
   * Un-verifying or deactivating takes the work back too. Otherwise a rider
   * removed from the platform would keep the addresses of everything already
   * in their hand, and the shop would sit waiting for a delivery nobody is
   * making.
   */
  const standsDown = verified === false || rest.isActive === false;

  const agent = await prisma.$transaction(async (tx) => {
    const updated = await tx.deliveryAgent.update({
      where: { id: params.id },
      data,
      select: { id: true, name: true, verifiedAt: true, isActive: true, userId: true },
    });

    if (standsDown) {
      await tx.shipment.updateMany({
        where: { assignedAgentUserId: updated.userId, status: 'PROCESSING' },
        data: { assignedAgentUserId: null },
      });
      await tx.deliveryAgent.update({
        where: { id: params.id },
        data: { isAvailable: false },
      });
    }

    return updated;
  });

  await recordAudit({
    actorUserId: params.actorUserId,
    action: 'admin.agent.updated',
    entityType: 'DeliveryAgent',
    entityId: agent.id,
    metadata: { patch: params.patch, reason: params.reason ?? null, standsDown },
    ipAddress: params.ipAddress ?? null,
  });

  return agent;
};
