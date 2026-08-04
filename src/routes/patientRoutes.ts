import { Router } from 'express';
import { z } from 'zod';
import {
  getPatientProfileHandler,
  updatePatientProfileHandler,
  getMedicalRecordHandler,
} from '../controllers/patientController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, latitudeSchema, longitudeSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt, authorizeRoles('PATIENT'));

router.get('/me', getPatientProfileHandler);

router.put(
  '/me',
  // Whitelisted fields only — the old handler spread raw req.body into storage.
  validate({
    body: z
      .object({
        fullName: z.string().trim().min(1).max(120).optional(),
        email: z.email('Must be a valid email address.').nullable().optional(),
        age: z.number().int().min(0).max(130).nullable().optional(),
        gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
        bloodGroup: z
          .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
          .nullable()
          .optional(),
        emergencyContact: z.string().trim().max(20).nullable().optional(),
        address: z.string().trim().max(300).nullable().optional(),
        latitude: latitudeSchema.nullable().optional(),
        longitude: longitudeSchema.nullable().optional(),
        /**
         * Comma-separated free text. These drive condition-matched health
         * content and are what a responder reads first on an SOS, so without
         * them the targeting has nothing to work with.
         */
        allergies: z.string().trim().max(500).nullable().optional(),
        chronicConditions: z.string().trim().max(500).nullable().optional(),
      })
      .strict(),
  }),
  updatePatientProfileHandler
);

router.get('/me/records', getMedicalRecordHandler);

export default router;
