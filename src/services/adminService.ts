import type { Role } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound } from '../utils/AppError.js';
import { recordAudit } from './auditService.js';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

/**
 * Real counts from the database. These were previously hardcoded constants
 * presented as live platform metrics.
 */
export const getAdminStatsService = async () => {
  const [
    totalPatients,
    totalDoctors,
    totalPharmacies,
    totalLabs,
    appointmentsToday,
    completedThisMonth,
    activeEmergencies,
    pendingMedicineOrders,
    pendingLabOrders,
    revenueAgg,
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.doctor.count(),
    prisma.pharmacy.count(),
    prisma.labPartner.count(),
    prisma.appointment.count({ where: { createdAt: { gte: startOfToday() } } }),
    prisma.appointment.count({
      where: { status: 'COMPLETED', updatedAt: { gte: startOfMonth() } },
    }),
    prisma.emergencySOS.count({ where: { status: { not: 'RESOLVED' } } }),
    prisma.medicineOrder.count({ where: { status: { in: ['PLACED', 'PROCESSING'] } } }),
    prisma.labOrder.count({ where: { status: { in: ['BOOKED', 'SAMPLE_COLLECTED', 'PROCESSING'] } } }),
    prisma.medicineOrder.aggregate({
      _sum: { totalAmount: true },
      where: { status: { not: 'CANCELLED' } },
    }),
  ]);

  return {
    totalPatients,
    totalDoctors,
    totalPharmacies,
    totalLabs,
    appointmentsToday,
    completedThisMonth,
    activeEmergencies,
    pendingMedicineOrders,
    pendingLabOrders,
    medicineRevenue: Number((revenueAgg._sum.totalAmount ?? 0).toFixed(2)),
    generatedAt: new Date().toISOString(),
  };
};

export const listUsersService = async (role?: string, page = 1, limit = 20) => {
  const where = role ? { role: role as Role } : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        phoneNumber: true,
        role: true,
        isVerified: true,
        isSuspended: true,
        createdAt: true,
        patient: { select: { fullName: true } },
        doctor: { select: { name: true, specialty: true } },
        pharmacy: { select: { name: true, isActive: true, drugLicenceExpiry: true } },
        labPartner: { select: { name: true, isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page, limit };
};

/**
 * Suspends or restores an account.
 *
 * Deliberately blocks self-suspension: an admin locking themselves out is an
 * easy misclick, and there may be no second admin to undo it.
 */
export const setUserSuspendedService = async (params: {
  actorUserId: string;
  userId: string;
  suspended: boolean;
  reason?: string;
  ipAddress?: string | null;
}) => {
  if (params.actorUserId === params.userId) {
    throw new AppError('You cannot suspend your own account.', 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, role: true },
  });
  if (!target) throw notFound('User');

  const user = await prisma.user.update({
    where: { id: params.userId },
    data: { isSuspended: params.suspended },
    select: { id: true, phoneNumber: true, role: true, isSuspended: true },
  });

  // Deactivate the shop too, so a suspended partner stops receiving orders
  // rather than only being unable to sign in.
  if (params.suspended) {
    await Promise.all([
      prisma.pharmacy.updateMany({ where: { userId: user.id }, data: { isActive: false } }),
      prisma.labPartner.updateMany({ where: { userId: user.id }, data: { isActive: false } }),
    ]);
  }

  await recordAudit({
    actorUserId: params.actorUserId,
    action: params.suspended ? 'user.suspended' : 'user.restored',
    entityType: 'User',
    entityId: user.id,
    metadata: { role: user.role, reason: params.reason ?? null },
    ipAddress: params.ipAddress ?? null,
  });

  return user;
};
