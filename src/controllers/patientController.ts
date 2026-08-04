import type { Response } from 'express';
import {
  getPatientProfileService,
  updatePatientProfileService,
  getPatientMedicalRecordService,
  type PatientProfileUpdate,
} from '../services/patientService.js';
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
