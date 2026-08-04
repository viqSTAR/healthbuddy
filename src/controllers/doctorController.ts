import type { Response } from 'express';
import {
  getDoctorsService,
  getDoctorByIdService,
  getDoctorSlotsService,
  getMyDoctorProfileService,
  updateMyDoctorProfileService,
  createSlotsService,
  deleteSlotService,
  getMyScheduleService,
} from '../services/doctorService.js';
import {
  asyncHandler,
  requireDoctorId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const getDoctorsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { specialty, query, page, limit } = req.query as unknown as {
    specialty?: string;
    query?: string;
    page: number;
    limit: number;
  };

  const result = await getDoctorsService(specialty, query, page, limit);
  res.status(200).json({ success: true, count: result.doctors.length, ...result });
});

export const getDoctorByIdHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  const doctor = await getDoctorByIdService(id);
  res.status(200).json({ success: true, doctor });
});

export const getDoctorSlotsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  const { date } = req.query as unknown as { date: string };
  const slots = await getDoctorSlotsService(id, date);
  res.status(200).json({ success: true, date, slots });
});

/* ---------- Doctor app: own profile and availability ---------- */

export const getMyDoctorProfileHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const doctor = await getMyDoctorProfileService(requireDoctorId(req));
    res.status(200).json({ success: true, doctor });
  }
);

export const updateMyDoctorProfileHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const doctorId = requireDoctorId(req);
    const doctor = await updateMyDoctorProfileService(doctorId, req.body as Record<string, never>);
    res.status(200).json({ success: true, doctor });
  }
);

export const getMyScheduleHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const doctorId = requireDoctorId(req);
    const { from, to } = req.query as unknown as { from: string; to: string };
    const slots = await getMyScheduleService(doctorId, from, to);
    res.status(200).json({ success: true, from, to, count: slots.length, slots });
  }
);

export const createSlotsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const doctorId = requireDoctorId(req);
  const { date, startTime, endTime, slotMinutes } = req.body as {
    date: string;
    startTime: string;
    endTime: string;
    slotMinutes: number;
  };
  const result = await createSlotsService({ doctorId, date, startTime, endTime, slotMinutes });
  res.status(201).json({ success: true, ...result });
});

export const deleteSlotHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const doctorId = requireDoctorId(req);
  const { slotId } = req.params as { slotId: string };
  res.status(200).json({ success: true, ...(await deleteSlotService(doctorId, slotId)) });
});
