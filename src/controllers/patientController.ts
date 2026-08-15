import type { Response } from 'express';
import {
  getPatientProfileService,
  updatePatientProfileService,
  getPatientMedicalRecordService,
  type PatientProfileUpdate,
} from '../services/patientService.js';
import { listVisitsService, getVisitService } from '../services/visitService.js';
import { asyncHandler, requirePatientId, type AuthenticatedRequest } from '../middlewares/auth.js';

export const getPatientProfileHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const patient = await getPatientProfileService(requirePatientId(req));
  res.status(200).json({ success: true, patient });
});

export const updatePatientProfileHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const patient = await updatePatientProfileService(
    requirePatientId(req),
    req.body as PatientProfileUpdate
  );
  res.status(200).json({ success: true, patient });
});

export const getMedicalRecordHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const record = await getPatientMedicalRecordService(requirePatientId(req));
  res.status(200).json({ success: true, ...record });
});

export const listVisitsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const visits = await listVisitsService(requirePatientId(req));
  res.status(200).json({ success: true, count: visits.length, visits });
});

export const getVisitHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const visit = await getVisitService(requirePatientId(req), (req.params as { id: string }).id);
  res.status(200).json({ success: true, visit });
});
