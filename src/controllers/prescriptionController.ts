import type { Response } from 'express';
import {
  createPrescriptionService,
  getPatientPrescriptionsService,
  getPrescriptionByIdService,
  getPrescribableMedicinesService,
  type MedicineLine,
} from '../services/prescriptionService.js';
import {
  asyncHandler,
  requireUser,
  requireDoctorId,
  requirePatientId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const createPrescriptionHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const doctorId = requireDoctorId(req);

    const { appointmentId, diagnosis, medicines, notes, advice, followUpDate } = req.body as {
      appointmentId: string;
      diagnosis: string;
      medicines: MedicineLine[];
      notes?: string;
      advice?: string;
      followUpDate?: string;
    };

    const prescription = await createPrescriptionService({
      doctorId,
      appointmentId,
      diagnosis,
      medicines,
      ...(notes ? { notes } : {}),
      ...(advice ? { advice } : {}),
      ...(followUpDate ? { followUpDate } : {}),
    });
    res.status(201).json({ success: true, message: 'Prescription issued.', prescription });
  }
);

/**
 * The drug picker for one appointment, with each entry marked prescribable or
 * refused under the telemedicine drug lists.
 */
export const getPrescribableMedicinesHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const doctorId = requireDoctorId(req);
    const { appointmentId } = req.params as { appointmentId: string };
    const { search } = req.query as unknown as { search?: string };
    const result = await getPrescribableMedicinesService(
      doctorId,
      appointmentId,
      search
    );
    res.status(200).json({ success: true, ...result });
  }
);

export const getMyPrescriptionsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const prescriptions = await getPatientPrescriptionsService(requirePatientId(req));
    res.status(200).json({ success: true, count: prescriptions.length, prescriptions });
  }
);

export const getPrescriptionByIdHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const prescription = await getPrescriptionByIdService(id, {
      patientId: user.patientId,
      doctorId: user.doctorId,
    });
    res.status(200).json({ success: true, prescription });
  }
);
