import type { Gender } from '@prisma/client';
import { prisma } from '../config/db.js';
import { notFound } from '../utils/AppError.js';
import { windowFor, type PageRequest } from '../utils/pagination.js';

const patientView = {
  id: true,
  fullName: true,
  email: true,
  age: true,
  gender: true,
  bloodGroup: true,
  emergencyContact: true,
  address: true,
  latitude: true,
  longitude: true,
  allergies: true,
  chronicConditions: true,
  createdAt: true,
  user: { select: { phoneNumber: true, role: true } },
};

export const getPatientProfileService = async (patientId: string) => {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: patientView });
  if (!patient) throw notFound('Patient profile');
  return patient;
};

export interface PatientProfileUpdate {
  fullName?: string;
  email?: string | null;
  age?: number | null;
  gender?: Gender | null;
  bloodGroup?: string | null;
  emergencyContact?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /**
   * Free text, comma-separated. Drives condition-matched health content and is
   * what a responder reads first in an emergency — without these fields the
   * targeting has nothing to match on.
   */
  allergies?: string | null;
  chronicConditions?: string | null;
}

/**
 * Only whitelisted columns are writable. The previous handler spread raw
 * req.body into stored state, so a client could set arbitrary fields.
 */
export const updatePatientProfileService = (patientId: string, data: PatientProfileUpdate) =>
  prisma.patient.update({ where: { id: patientId }, data, select: patientView });

/**
 * The flat record: three histories in one response.
 *
 * Windowed per list rather than as a whole, because they grow at different
 * rates — someone with sixty consultations may have four lab results — and a
 * single offset across all three would page one of them off the end.
 */
export const getPatientMedicalRecordService = async (
  patientId: string,
  page?: PageRequest
) => {
  const w = windowFor(page);

  const [appointments, prescriptions, labOrders] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: w.take,
      skip: w.skip,
      include: {
        doctor: { select: { name: true, specialty: true } },
        slot: { select: { date: true, startTime: true } },
      },
    }),
    prisma.prescription.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: w.take,
      skip: w.skip,
      include: { doctor: { select: { name: true, specialty: true } } },
    }),
    prisma.labOrder.findMany({
      where: { patientId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: w.take,
      skip: w.skip,
    }),
  ]);

  return { appointments, prescriptions, labOrders, page: w.page, limit: w.limit };
};
