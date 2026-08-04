import { Router } from 'express';
import { z } from 'zod';
import {
  listMyFulfilmentsHandler,
  getFulfilmentHandler,
  consentHandler,
  declineHandler,
  expireStaleHandler,
} from '../controllers/fulfilmentController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, uuidSchema, latitudeSchema, longitudeSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

/* ---------- Patient ---------- */

router.get('/mine', authorizeRoles('PATIENT'), listMyFulfilmentsHandler);

/**
 * Consent. Note what the body does NOT contain: prices. Those come from the
 * stored quote, so the patient is charged exactly what they were shown and a
 * tampered request cannot change the amount.
 */
router.post(
  '/:id/consent',
  authorizeRoles('PATIENT'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      // Empty or absent means "everything in the basket".
      acceptMedicineIds: z.array(uuidSchema).max(50).optional(),
      acceptLabPackageIds: z.array(uuidSchema).max(50).optional(),
      deliveryAddress: z.string().trim().min(5, 'A delivery address is required.').max(300),
      latitude: latitudeSchema.optional(),
      longitude: longitudeSchema.optional(),
    }),
  }),
  consentHandler
);

router.post(
  '/:id/decline',
  authorizeRoles('PATIENT'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ reason: z.string().trim().max(500).optional() }),
  }),
  declineHandler
);

/* ---------- Admin maintenance ---------- */

// Mounted before `/:id` so it is not captured as a fulfilment id.
router.post('/expire-stale', authorizeRoles('ADMIN'), expireStaleHandler);

router.get(
  '/:id',
  authorizeRoles('PATIENT'),
  validate({ params: z.object({ id: uuidSchema }) }),
  getFulfilmentHandler
);

export default router;
