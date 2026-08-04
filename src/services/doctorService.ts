import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';

const doctorCard = {
  id: true,
  name: true,
  specialty: true,
  experienceYears: true,
  consultationFee: true,
  rating: true,
  clinicAddress: true,
  isAvailable: true,
} satisfies Prisma.DoctorSelect;

export const getDoctorsService = async (
  specialty?: string,
  searchQuery?: string,
  page = 1,
  limit = 20
) => {
  const where: Prisma.DoctorWhereInput = {
    ...(specialty ? { specialty: { equals: specialty, mode: 'insensitive' } } : {}),
    ...(searchQuery
      ? {
          OR: [
            { name: { contains: searchQuery, mode: 'insensitive' } },
            { specialty: { contains: searchQuery, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [doctors, total] = await Promise.all([
    prisma.doctor.findMany({
      where,
      select: doctorCard,
      orderBy: [{ rating: 'desc' }, { experienceYears: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.doctor.count({ where }),
  ]);

  return { doctors, total, page, limit };
};

export const getDoctorByIdService = async (id: string) => {
  const doctor = await prisma.doctor.findUnique({ where: { id }, select: doctorCard });
  if (!doctor) throw notFound('Doctor');
  return doctor;
};

export const getDoctorSlotsService = async (doctorId: string, date: string) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
  if (!doctor) throw notFound('Doctor');

  return prisma.doctorSlot.findMany({
    where: { doctorId, date },
    select: { id: true, doctorId: true, date: true, startTime: true, endTime: true, status: true },
    orderBy: { startTime: 'asc' },
  });
};

/* ---------- Doctor-facing profile & availability ---------- */

export const getMyDoctorProfileService = async (doctorId: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { user: { select: { id: true, phoneNumber: true } } },
  });
  if (!doctor) throw notFound('Doctor');
  return doctor;
};

export const updateMyDoctorProfileService = (
  doctorId: string,
  data: {
    name?: string;
    specialty?: string;
    qualification?: string;
    experienceYears?: number;
    consultationFee?: number;
    about?: string;
    languages?: string;
    clinicAddress?: string;
    isAvailable?: boolean;
  }
) =>
  prisma.doctor.update({
    where: { id: doctorId },
    // The registration number and verification stamp are deliberately absent:
    // those are set by the approval flow, not editable by the doctor.
    data,
  });

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const minutesOf = (time: string): number => {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Generates bookable slots for one day.
 *
 * Slots already taken are left alone — regenerating a day must never silently
 * cancel a patient's booked appointment, so existing rows are skipped rather
 * than overwritten.
 */
export const createSlotsService = async (params: {
  doctorId: string;
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}) => {
  if (!DATE_PATTERN.test(params.date)) {
    throw new AppError('Date must be in YYYY-MM-DD format.', 400);
  }
  if (!TIME_PATTERN.test(params.startTime) || !TIME_PATTERN.test(params.endTime)) {
    throw new AppError('Times must be in 24-hour HH:mm format.', 400);
  }

  const start = minutesOf(params.startTime);
  const end = minutesOf(params.endTime);
  if (end <= start) throw new AppError('The end time must be after the start time.', 400);

  const span = end - start;
  if (span / params.slotMinutes > 48) {
    throw new AppError('That range would create more than 48 slots in a single day.', 400);
  }

  const format = (total: number) =>
    `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

  const candidates: { date: string; startTime: string; endTime: string }[] = [];
  for (let cursor = start; cursor + params.slotMinutes <= end; cursor += params.slotMinutes) {
    candidates.push({
      date: params.date,
      startTime: format(cursor),
      endTime: format(cursor + params.slotMinutes),
    });
  }

  if (candidates.length === 0) {
    throw new AppError('That range is shorter than a single slot.', 400);
  }

  const created = await prisma.doctorSlot.createMany({
    data: candidates.map((c) => ({ ...c, doctorId: params.doctorId })),
    skipDuplicates: true,
  });

  return {
    created: created.count,
    skipped: candidates.length - created.count,
    slots: await getDoctorSlotsService(params.doctorId, params.date),
  };
};

/** Removes a free slot. A booked slot must be cancelled through the appointment. */
export const deleteSlotService = async (doctorId: string, slotId: string) => {
  const slot = await prisma.doctorSlot.findUnique({
    where: { id: slotId },
    select: { id: true, doctorId: true, status: true },
  });

  // 404 rather than 403 so slot ids belonging to other doctors cannot be probed.
  if (!slot || slot.doctorId !== doctorId) throw notFound('Slot');
  if (slot.status !== 'AVAILABLE') {
    throw conflict('That slot is booked. Cancel the appointment before removing it.');
  }

  await prisma.doctorSlot.delete({ where: { id: slot.id } });
  return { removed: true };
};

/** The doctor's own schedule across a date range, with patient context. */
export const getMyScheduleService = (doctorId: string, from: string, to: string) =>
  prisma.doctorSlot.findMany({
    where: { doctorId, date: { gte: from, lte: to } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    include: {
      appointment: {
        select: {
          id: true,
          status: true,
          type: true,
          symptoms: true,
          isFollowUp: true,
          patient: { select: { id: true, fullName: true, age: true, gender: true } },
        },
      },
    },
  });
