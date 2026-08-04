import { randomUUID } from 'node:crypto';
import type { AppointmentType } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';

const appointmentView = {
  id: true,
  patientId: true,
  doctorId: true,
  slotId: true,
  type: true,
  status: true,
  symptoms: true,
  meetingRoomId: true,
  isFollowUp: true,
  createdAt: true,
  slot: { select: { date: true, startTime: true, endTime: true } },
  doctor: { select: { id: true, name: true, specialty: true, consultationFee: true } },
  patient: { select: { id: true, fullName: true } },
};

/**
 * Books a slot atomically.
 *
 * The original code read a Redis key then wrote it — a check-then-act race that
 * let concurrent callers all book the same slot. Correctness now rests on the
 * database:
 *
 *  1. `updateMany` with `status: AVAILABLE` in the WHERE clause is a single
 *     atomic compare-and-swap. Exactly one concurrent caller sees count 1.
 *  2. `Appointment.slotId` is UNIQUE, so even a bypass of step 1 cannot produce
 *     two appointments for one slot.
 *
 * Deliberately NOT wrapped in an interactive transaction: that would hold the
 * slot's row lock across several network round trips, and under contention the
 * losers block until the transaction timeout expires (observed against a remote
 * database). Keeping the claim to one statement means the lock is held for a
 * single round trip; the create below compensates if it fails.
 */
export const bookAppointmentService = async (
  patientId: string,
  doctorId: string,
  slotId: string,
  type: AppointmentType,
  symptoms?: string
) => {
  const slot = await prisma.doctorSlot.findUnique({
    where: { id: slotId },
    select: { id: true, doctorId: true },
  });

  if (!slot) throw notFound('Slot');
  if (slot.doctorId !== doctorId) {
    throw new AppError('That slot does not belong to the requested doctor.', 400);
  }

  /**
   * Whether this is a follow-up decides which telemedicine drug lists the
   * doctor may prescribe from, so it is derived from history at booking time
   * rather than accepted from the client.
   */
  const priorConsult = await prisma.appointment.findFirst({
    where: { patientId, doctorId, status: 'COMPLETED' },
    select: { id: true },
  });

  // Atomic claim — the authoritative check, independent of the read above.
  const claimed = await prisma.doctorSlot.updateMany({
    where: { id: slotId, doctorId, status: 'AVAILABLE' },
    data: { status: 'BOOKED' },
  });

  if (claimed.count === 0) {
    throw conflict('That slot has just been taken. Please choose another.');
  }

  try {
    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        slotId,
        type,
        symptoms: symptoms?.trim() || null,
        meetingRoomId: type === 'VIDEO' ? `room_${randomUUID()}` : null,
        isFollowUp: Boolean(priorConsult),
      },
      select: appointmentView,
    });

    const doctorUser = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { user: { select: { id: true } } },
    });

    if (doctorUser) {
      await notify({
        userId: doctorUser.user.id,
        type: 'APPOINTMENT_BOOKED',
        title: 'New appointment',
        body: `${appointment.patient.fullName} booked ${appointment.slot.date} at ${appointment.slot.startTime}.`,
        data: { appointmentId: appointment.id },
        appId: 'DOCTOR',
      });
    }

    return appointment;
  } catch (err) {
    // Never strand a claimed slot as permanently unbookable.
    await prisma.doctorSlot
      .updateMany({ where: { id: slotId, status: 'BOOKED' }, data: { status: 'AVAILABLE' } })
      .catch(() => undefined);
    throw err;
  }
};

export const getPatientAppointmentsService = (patientId: string) =>
  prisma.appointment.findMany({
    where: { patientId },
    select: appointmentView,
    orderBy: { createdAt: 'desc' },
  });

/**
 * The doctor's queue.
 *
 * Bounded deliberately: an unbounded findMany here returned every appointment a
 * doctor had ever had, on every dashboard load. Cancelled and long-completed
 * consults are history, not a working queue.
 */
export const getDoctorAppointmentsService = (doctorId: string, limit = 100) =>
  prisma.appointment.findMany({
    where: { doctorId },
    select: {
      ...appointmentView,
      // Condition photos the patient attached; the doctor of THIS appointment
      // is authorised to open them.
      documents: {
        where: { kind: 'CONDITION_PHOTO' },
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

/** Cancels an appointment and returns the slot to the pool. */
export const cancelAppointmentService = async (appointmentId: string, patientId: string) => {
  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, patientId: true, slotId: true, status: true },
    });

    if (!appointment) throw notFound('Appointment');
    // Ownership check — an appointment id alone must not grant access.
    if (appointment.patientId !== patientId) throw notFound('Appointment');
    if (appointment.status === 'CANCELLED') throw conflict('This appointment is already cancelled.');
    if (appointment.status === 'COMPLETED') throw conflict('A completed appointment cannot be cancelled.');

    await tx.doctorSlot.update({ where: { id: appointment.slotId }, data: { status: 'AVAILABLE' } });

    return tx.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELLED' },
      select: appointmentView,
    });
  });
};
