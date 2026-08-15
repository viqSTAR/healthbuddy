import { Router } from 'express';
import { z } from 'zod';
import {
  createPrescriptionHandler,
  getMyPrescriptionsHandler,
  getPrescriptionByIdHandler,
  getPrescribableMedicinesHandler,
  printPrescriptionHandler,
  verifyPrescriptionHandler,
  markItemObtainedHandler,
} from '../controllers/prescriptionController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';

const router = Router();

/**
 * Public: confirms a printed prescription is genuine.
 *
 * Mounted before the auth guard deliberately. Whoever is holding the paper —
 * a pharmacist, the patient's family — must be able to check it without an
 * account, which is the entire reason the code is printed. It reveals the
 * issuer and the date and nothing clinical.
 */
router.get(
  '/verify/:code',
  validate({ params: z.object({ code: z.string().trim().min(6).max(16) }) }),
  verifyPrescriptionHandler
);

router.use(authenticateJwt);

router.post(
  '/',
  authorizeRoles('DOCTOR'),
  validate({
    body: z.object({
      appointmentId: uuidSchema,
      diagnosis: z.string().trim().min(1, 'A diagnosis is required.').max(2000),
      medicines: z
        .array(
          z.object({
            // Optional so a doctor can still write a drug not in the catalogue,
            // but only catalogue-linked lines can be checked against the
            // telemedicine drug lists.
            medicineId: uuidSchema.optional(),
            name: z.string().trim().min(1).max(200),
            dosage: z.string().trim().min(1).max(100),
            frequency: z.string().trim().min(1).max(100),
            durationDays: z.number().int().min(1).max(365).optional(),
            instructions: z.string().trim().max(500).optional(),
          })
        )
        .min(1, 'At least one medicine is required.')
        .max(30),
      // Tests the doctor wants run. A catalogue id makes them auto-bookable
      // through the consent flow; free text still records the advice.
      labTests: z
        .array(
          z.object({
            labPackageId: uuidSchema.optional(),
            testName: z.string().trim().min(1).max(200),
            instructions: z.string().trim().max(500).optional(),
            urgent: z.boolean().optional(),
          })
        )
        .max(20)
        .optional(),
      notes: z.string().trim().max(2000).optional(),
      advice: z.string().trim().max(2000).optional(),
      followUpDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
        .optional(),
    }),
  }),
  createPrescriptionHandler
);

/** Drug picker scoped to one appointment's consultation mode and history. */
router.get(
  '/prescribable/:appointmentId',
  authorizeRoles('DOCTOR'),
  validate({
    params: z.object({ appointmentId: uuidSchema }),
    query: z.object({ search: z.string().trim().max(120).optional() }),
  }),
  getPrescribableMedicinesHandler
);

router.get('/mine', authorizeRoles('PATIENT'), getMyPrescriptionsHandler);

// Readable only by the owning patient or the prescribing doctor.
router.get(
  '/:id',
  authorizeRoles('PATIENT', 'DOCTOR'),
  validate({ params: z.object({ id: uuidSchema }) }),
  getPrescriptionByIdHandler
);

/** Patient or issuing doctor only; the service checks which. */
router.get(
  '/:id/print',
  validate({ params: z.object({ id: uuidSchema }) }),
  printPrescriptionHandler
);

/**
 * A patient closing a line they sourced elsewhere.
 *
 * Patient-only by design: it is a statement about what they did, not a clinical
 * edit, and the prescription itself stays exactly as the doctor wrote it.
 */
router.post(
  '/items/:id/obtained',
  authorizeRoles('PATIENT'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      kind: z.enum(['MEDICINE', 'LAB_TEST']),
      obtained: z.boolean().default(true),
    }),
  }),
  markItemObtainedHandler
);

export default router;
