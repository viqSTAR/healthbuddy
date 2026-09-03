import { Prisma, type AppointmentType, type Medicine } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { recordAudit } from './auditService.js';
import { createFulfilmentForPrescription } from './fulfilmentService.js';
import { windowFor, type PageRequest } from '../utils/pagination.js';

export interface MedicineLine {
  /** Catalogue reference. Absent for a drug the doctor typed by hand. */
  medicineId?: string;
  name: string;
  dosage: string;
  frequency: string;
  durationDays?: number;
  instructions?: string;
}

export interface LabTestLine {
  /** Catalogue reference; absent means it cannot be auto-booked. */
  labPackageId?: string;
  testName: string;
  instructions?: string;
  urgent?: boolean;
}

const prescriptionView = {
  id: true,
  appointmentId: true,
  patientId: true,
  doctorId: true,
  diagnosis: true,
  medicines: true,
  notes: true,
  advice: true,
  followUpDate: true,
  doctorRegistrationNumber: true,
  consultationMode: true,
  wasFollowUp: true,
  createdAt: true,
  doctor: { select: { name: true, specialty: true, qualification: true } },
  patient: { select: { fullName: true, age: true, gender: true } },
  items: true,
  labTests: true,
};

/**
 * Telemedicine prescribing rules.
 *
 * The Telemedicine Practice Guidelines make what a doctor may prescribe a
 * function of HOW the consultation happened, not clinical judgement alone:
 *
 *   List O       — always available
 *   List A       — first consult permitted, but only over video
 *   List B       — follow-up consultations only
 *   Prohibited   — never over telemedicine
 *
 * Schedule X and narcotics are refused outright regardless of list.
 *
 * Returning the reason (rather than a bare boolean) lets the doctor app grey a
 * drug out with an explanation instead of silently hiding it.
 */
export const prescribingRefusal = (
  medicine: Pick<Medicine, 'name' | 'schedule' | 'teleList'>,
  context: { mode: AppointmentType; isFollowUp: boolean }
): string | null => {
  if (medicine.schedule === 'SCHEDULE_X' || medicine.schedule === 'NARCOTIC') {
    return `${medicine.name} is a ${medicine.schedule === 'NARCOTIC' ? 'narcotic' : 'Schedule X'} drug and cannot be prescribed remotely.`;
  }

  // An in-person consultation is outside the telemedicine guidelines entirely.
  if (context.mode === 'IN_PERSON') return null;

  switch (medicine.teleList) {
    case 'PROHIBITED':
      return `${medicine.name} is on the prohibited list and cannot be prescribed over telemedicine.`;
    case 'LIST_B':
      return context.isFollowUp
        ? null
        : `${medicine.name} is a List B drug and may only be prescribed in a follow-up consultation.`;
    case 'LIST_A':
      return context.mode === 'VIDEO'
        ? null
        : `${medicine.name} is a List A drug and requires a video consultation.`;
    default:
      return null;
  }
};

/**
 * The catalogue as it applies to one appointment: every medicine, each marked
 * prescribable or not with the reason. Drives the doctor app's drug picker.
 */
export const getPrescribableMedicinesService = async (
  doctorId: string,
  appointmentId: string,
  search?: string
) => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, doctorId: true, type: true, isFollowUp: true },
  });

  if (!appointment || appointment.doctorId !== doctorId) throw notFound('Appointment');

  const medicines = await prisma.medicine.findMany({
    where: {
      // Never surface drugs that cannot be dispensed online at all.
      schedule: { notIn: ['SCHEDULE_X', 'NARCOTIC'] },
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: { name: 'asc' },
    take: 200,
  });

  const context = { mode: appointment.type, isFollowUp: appointment.isFollowUp };

  return {
    consultationMode: appointment.type,
    isFollowUp: appointment.isFollowUp,
    medicines: medicines.map((m) => {
      const refusal = prescribingRefusal(m, context);
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        composition: m.composition,
        schedule: m.schedule,
        teleList: m.teleList,
        requiresPrescription: m.requiresPrescription,
        prescribable: refusal === null,
        ...(refusal ? { reason: refusal } : {}),
      };
    }),
  };
};

/** Only the doctor who owns the appointment may issue its prescription. */
export const createPrescriptionService = async (params: {
  doctorId: string;
  appointmentId: string;
  diagnosis: string;
  medicines: MedicineLine[];
  labTests?: LabTestLine[];
  notes?: string;
  advice?: string;
  followUpDate?: string;
}) => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    select: {
      id: true,
      doctorId: true,
      patientId: true,
      status: true,
      type: true,
      isFollowUp: true,
      patient: { select: { userId: true, fullName: true } },
    },
  });

  if (!appointment) throw notFound('Appointment');
  // 404 rather than 403 so appointment ids cannot be probed across doctors.
  if (appointment.doctorId !== params.doctorId) throw notFound('Appointment');
  if (appointment.status === 'CANCELLED') {
    throw new AppError('Cannot prescribe against a cancelled appointment.', 400);
  }

  const existing = await prisma.prescription.findUnique({
    where: { appointmentId: params.appointmentId },
  });
  if (existing) throw conflict('A prescription already exists for this appointment.');

  const doctor = await prisma.doctor.findUnique({
    where: { id: params.doctorId },
    select: { councilRegistrationNumber: true },
  });

  // Enforce the drug lists server-side. The app filters its picker, but the
  // rule cannot live only in the client.
  const referenced = params.medicines
    .map((m) => m.medicineId)
    .filter((id): id is string => Boolean(id));

  const catalogue = referenced.length
    ? await prisma.medicine.findMany({ where: { id: { in: referenced } } })
    : [];
  const byId = new Map(catalogue.map((m) => [m.id, m]));

  const context = { mode: appointment.type, isFollowUp: appointment.isFollowUp };
  const refusals: string[] = [];

  for (const line of params.medicines) {
    if (!line.medicineId) continue;
    const medicine = byId.get(line.medicineId);
    if (!medicine) throw notFound(`Medicine ${line.medicineId}`);
    const refusal = prescribingRefusal(medicine, context);
    if (refusal) refusals.push(refusal);
  }

  if (refusals.length) throw new AppError(refusals.join(' '), 422);

  const prescription = await prisma.$transaction(async (tx) => {
    const created = await tx.prescription.create({
      data: {
        appointmentId: params.appointmentId,
        patientId: appointment.patientId,
        doctorId: params.doctorId,
        diagnosis: params.diagnosis,
        medicines: params.medicines as unknown as Prisma.InputJsonValue,
        notes: params.notes?.trim() || null,
        advice: params.advice?.trim() || null,
        followUpDate: params.followUpDate ?? null,
        // Stamped now so the record stays faithful if the profile changes later.
        doctorRegistrationNumber: doctor?.councilRegistrationNumber ?? null,
        consultationMode: appointment.type,
        wasFollowUp: appointment.isFollowUp,
        items: {
          create: params.medicines.map((line) => ({
            medicineId: line.medicineId ?? null,
            name: line.name,
            dosage: line.dosage,
            frequency: line.frequency,
            durationDays: line.durationDays ?? null,
            instructions: line.instructions ?? null,
          })),
        },
        ...(params.labTests?.length
          ? {
              labTests: {
                create: params.labTests.map((test) => ({
                  labPackageId: test.labPackageId ?? null,
                  testName: test.testName,
                  instructions: test.instructions ?? null,
                  urgent: test.urgent ?? false,
                })),
              },
            }
          : {}),
      },
      select: prescriptionView,
    });

    await tx.appointment.update({
      where: { id: params.appointmentId },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });

    return created;
  });

  await recordAudit({
    actorUserId: null,
    action: 'prescription.issued',
    entityType: 'Prescription',
    entityId: prescription.id,
    metadata: {
      doctorId: params.doctorId,
      appointmentId: params.appointmentId,
      consultationMode: appointment.type,
      itemCount: params.medicines.length,
    },
  });

  /**
   * Price the prescription into a basket the patient can approve in one tap.
   *
   * Awaited so the patient's notification names a real total, but it never
   * throws into this path — a pricing failure must not undo a valid
   * prescription. It sends its own notification, so there is none here.
   */
  await createFulfilmentForPrescription(prescription.id);

  /**
   * Writing the prescription is the other way a consultation ends.
   *
   * The follow-up channel is earned by a completed consultation, and the
   * transaction above completes the appointment. Ending the video call opens a
   * thread; this path did not, so the most common flow of all — see the
   * patient, prescribe, done — left the patient with no way to ask a follow-up
   * question. In-person consultations never open a video room at all, so they
   * earned a channel that was never created.
   *
   * Lazily imported and non-throwing for the same reasons as in videoService:
   * the prescription is valid and issued, and losing the chat window must not
   * make it look otherwise.
   */
  try {
    const { openChatForAppointmentService } = await import('./chatService.js');
    await openChatForAppointmentService(params.appointmentId);
  } catch (err) {
    logger.error(`[chat] could not open a thread for appointment ${params.appointmentId}`, err);
  }

  return prescription;
};

export const getPatientPrescriptionsService = (patientId: string, page?: PageRequest) => {
  const w = windowFor(page);
  return prisma.prescription.findMany({
    where: { patientId },
    select: prescriptionView,
    orderBy: { createdAt: 'desc' },
    take: w.take,
    skip: w.skip,
  });
};

/** Readable by the owning patient or the prescribing doctor — nobody else. */
export const getPrescriptionByIdService = async (
  id: string,
  viewer: { patientId?: string; doctorId?: string }
) => {
  const prescription = await prisma.prescription.findUnique({
    where: { id },
    select: prescriptionView,
  });
  if (!prescription) throw notFound('Prescription');

  const isOwner =
    (viewer.patientId && prescription.patientId === viewer.patientId) ||
    (viewer.doctorId && prescription.doctorId === viewer.doctorId);

  if (!isOwner) throw notFound('Prescription');
  return prescription;
};

/**
 * The patient tells us they got an item themselves.
 *
 * A prescription routinely outruns the platform: someone picks the antibiotic
 * up from the chemist downstairs, or has the blood test done at a hospital they
 * were already attending. Without a way to say so, those lines sit on the visit
 * as outstanding forever and the only way to clear them is to buy them twice.
 *
 * Deliberately not recorded as fulfilled. There is no order, no payment and no
 * record of what was actually dispensed, so claiming the platform supplied it
 * would put a falsehood in a medical record. It marks who closed it and when,
 * and nothing more.
 *
 * Reversible, because people tap the wrong row.
 */
export const markPrescribedItemObtainedService = async (params: {
  patientId: string;
  itemId: string;
  kind: 'MEDICINE' | 'LAB_TEST';
  obtained: boolean;
}) => {
  const { patientId, itemId, kind, obtained } = params;
  const at = obtained ? new Date() : null;

  if (kind === 'MEDICINE') {
    const item = await prisma.prescribedMedicine.findUnique({
      where: { id: itemId },
      select: { id: true, prescription: { select: { patientId: true } } },
    });
    // 404 rather than 403 so item ids cannot be probed across patients.
    if (!item || item.prescription.patientId !== patientId) throw notFound('Prescribed medicine');

    return prisma.prescribedMedicine.update({
      where: { id: itemId },
      data: { selfObtainedAt: at },
      select: { id: true, name: true, selfObtainedAt: true },
    });
  }

  const test = await prisma.prescribedLabTest.findUnique({
    where: { id: itemId },
    select: { id: true, prescription: { select: { patientId: true } } },
  });
  if (!test || test.prescription.patientId !== patientId) throw notFound('Prescribed test');

  return prisma.prescribedLabTest.update({
    where: { id: itemId },
    data: { selfObtainedAt: at },
    select: { id: true, testName: true, selfObtainedAt: true },
  });
};
