import type { Response } from 'express';
import type { AppointmentType } from '@prisma/client';
import {
  bookAppointmentService,
  getPatientAppointmentsService,
  getDoctorAppointmentsService,
  cancelAppointmentService,
} from '../services/appointmentService.js';
import {
  asyncHandler,
  requireUser,
  requirePatientId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';
import { forbidden } from '../utils/AppError.js';

/**
 * Optional `?page=&limit=` off the query string.
 *
 * Every one of these endpoints answers safely with no parameters at all — the
 * service clamps to a default window — so existing clients keep working
 * unchanged and only a client that wants a second page has to ask for one.
 */
const pageOf = (req: AuthenticatedRequest) => {
  const q = req.query as { page?: unknown; limit?: unknown };
  return {
    ...(q.page !== undefined ? { page: Number(q.page) } : {}),
    ...(q.limit !== undefined ? { limit: Number(q.limit) } : {}),
  };
};


export const bookAppointmentHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const patientId = requirePatientId(req);
  const { doctorId, slotId, type, symptoms } = req.body as {
    doctorId: string;
    slotId: string;
    type: AppointmentType;
    symptoms?: string;
  };

  const appointment = await bookAppointmentService(patientId, doctorId, slotId, type, symptoms);
  res.status(201).json({ success: true, message: 'Appointment booked.', appointment });
});

export const getPatientAppointmentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const appointments = await getPatientAppointmentsService(requirePatientId(req), pageOf(req));
    res.status(200).json({ success: true, count: appointments.length, appointments });
  }
);

export const getDoctorAppointmentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    // Scoped to the caller's own doctor profile, not an arbitrary id.
    if (!user.doctorId) throw forbidden('This endpoint requires a doctor profile.');

    const appointments = await getDoctorAppointmentsService(user.doctorId);
    res.status(200).json({ success: true, count: appointments.length, appointments });
  }
);

export const cancelAppointmentHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  const appointment = await cancelAppointmentService(id, requirePatientId(req));
  res.status(200).json({ success: true, message: 'Appointment cancelled.', appointment });
});
