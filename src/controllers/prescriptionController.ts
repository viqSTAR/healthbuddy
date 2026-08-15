import type { Request, Response } from 'express';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import {
  createPrescriptionService,
  getPatientPrescriptionsService,
  getPrescriptionByIdService,
  getPrescribableMedicinesService,
  markPrescribedItemObtainedService,
  type MedicineLine,
  type LabTestLine,
} from '../services/prescriptionService.js';
import {
  renderPrescriptionService,
  verifyPrescriptionService,
} from '../services/prescriptionPrintService.js';
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

    const { appointmentId, diagnosis, medicines, labTests, notes, advice, followUpDate } =
      req.body as {
        appointmentId: string;
        diagnosis: string;
        medicines: MedicineLine[];
        labTests?: LabTestLine[];
        notes?: string;
        advice?: string;
        followUpDate?: string;
      };

    const prescription = await createPrescriptionService({
      doctorId,
      appointmentId,
      diagnosis,
      medicines,
      ...(labTests?.length ? { labTests } : {}),
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

/**
 * The printable prescription.
 *
 * Returns HTML rather than JSON: the client opens it in a browser and prints
 * to PDF, which means the layout is fixed by the platform and cannot be
 * reassembled by a caller into something that omits the mandatory fields.
 */
export const printPrescriptionHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);

    const [patient, doctor] = await Promise.all([
      prisma.patient.findUnique({ where: { userId: user.userId }, select: { id: true } }),
      prisma.doctor.findUnique({ where: { userId: user.userId }, select: { id: true } }),
    ]);

    const { html } = await renderPrescriptionService(
      (req.params as { id: string }).id,
      {
        ...(patient ? { patientId: patient.id } : {}),
        ...(doctor ? { doctorId: doctor.id } : {}),
      },
      env.PUBLIC_BASE_URL
    );

    res.status(200).type('html').send(html);
  }
);

/**
 * The public check. No authentication: the code travels on a printed sheet and
 * the whole point is that whoever holds it can verify it. It answers who issued
 * the prescription and when — never what was prescribed.
 */
export const verifyPrescriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await verifyPrescriptionService((req.params as { code: string }).code);
  res.status(200).json({ success: true, ...result });
});

/** Patient-only: close or reopen a prescribed line they sourced themselves. */
export const markItemObtainedHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const { kind, obtained } = req.body as {
      kind: 'MEDICINE' | 'LAB_TEST';
      obtained: boolean;
    };

    const item = await markPrescribedItemObtainedService({
      patientId: requirePatientId(req),
      itemId: id,
      kind,
      obtained,
    });

    res.status(200).json({ success: true, item });
  }
);
