import type { EmergencyStatus } from '@prisma/client';
import { prisma } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { notFound } from '../utils/AppError.js';
import { windowFor, type PageRequest } from '../utils/pagination.js';

const AMBULANCE_CONTROL_NUMBER = '+18005559111';

export const triggerEmergencySOSService = async (
  patientId: string,
  latitude: number,
  longitude: number
) => {
  const sos = await prisma.emergencySOS.create({
    data: { patientId, latitude, longitude, status: 'DISPATCHED' },
    include: { patient: { select: { id: true, fullName: true, emergencyContact: true } } },
  });

  logger.warn(`[SOS] Dispatch requested by patient ${patientId} at ${latitude},${longitude}`);

  return {
    ...sos,
    ambulanceControlContact: AMBULANCE_CONTROL_NUMBER,
  };
};

/** A patient may only read their own SOS history. */
export const getPatientEmergencyHistoryService = (patientId: string, page?: PageRequest) => {
  const w = windowFor(page);
  return prisma.emergencySOS.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: w.take,
    skip: w.skip,
  });
};

/**
 * The live dispatch queue. Contains every patient's real-time location, so it
 * is ADMIN-only — it was previously readable by any authenticated patient.
 */
/**
 * Capped even though "active" is naturally small.
 *
 * It is small on an ordinary day. The day it is not — a building fire, a bus
 * crash — is the day this screen is being watched, and an unbounded read is
 * slowest exactly then.
 */
export const getActiveEmergencyQueueService = (page?: PageRequest) => {
  const w = windowFor(page);
  return prisma.emergencySOS.findMany({
    where: { status: { not: 'RESOLVED' } },
    orderBy: { createdAt: 'desc' },
    take: w.take,
    skip: w.skip,
    include: {
      patient: {
        select: { id: true, fullName: true, bloodGroup: true, emergencyContact: true },
      },
    },
  });
};

export const updateEmergencyStatusService = async (sosId: string, status: EmergencyStatus) => {
  const sos = await prisma.emergencySOS.findUnique({ where: { id: sosId } });
  if (!sos) throw notFound('SOS record');

  return prisma.emergencySOS.update({
    where: { id: sosId },
    data: { status, ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}) },
  });
};
