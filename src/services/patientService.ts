import type { Gender } from '@prisma/client';
import { prisma } from '../config/db.js';
import { notFound } from '../utils/AppError.js';

const patientView = {
  id: true,
  fullName: true,
  email: true,
  age: true,
  gender: true,
  bloodGroup: true,
  emergencyContact: true,
  address: true,
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
}

/**
 * Only whitelisted columns are writable. The previous handler spread raw
 * req.body into stored state, so a client could set arbitrary fields.
 */
export const updatePatientProfileService = (patientId: string, data: PatientProfileUpdate) =>
  prisma.patient.update({ where: { id: patientId }, data, select: patientView });

export const getPatientMedicalRecordService = async (patientId: string) => {
  const [appointments, prescriptions, labOrders] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: {
        doctor: { select: { name: true, specialty: true } },
        slot: { select: { date: true, startTime: true } },
      },
    }),
    prisma.prescription.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: { doctor: { select: { name: true, specialty: true } } },
    }),
    prisma.labOrder.findMany({
      where: { patientId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { appointments, prescriptions, labOrders };
};
