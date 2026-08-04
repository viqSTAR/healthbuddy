import { Router } from 'express';
import { z } from 'zod';
import {
  createPrescriptionHandler,
  getMyPrescriptionsHandler,
  getPrescriptionByIdHandler,
  getPrescribableMedicinesHandler,
} from '../controllers/prescriptionController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';

const router = Router();

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

export default router;
