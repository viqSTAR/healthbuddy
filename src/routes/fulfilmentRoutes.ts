import { Router } from 'express';
import { z } from 'zod';
import {
  listMyFulfilmentsHandler,
  getFulfilmentHandler,
  consentHandler,
  declineHandler,
  requoteHandler,
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
      // A saved address, or a typed one. The service requires at least one and
      // copies whichever it resolves onto the order.
      addressId: uuidSchema.optional(),
      deliveryAddress: z.string().trim().min(5).max(300).optional(),
      latitude: latitudeSchema.optional(),
      longitude: longitudeSchema.optional(),
      // Approving and choosing how to pay are one action for the patient, so
      // consent carries the method and opens the checkout in the same call.
      paymentMethod: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']).default('UPI'),
    })
      .refine((b) => Boolean(b.addressId ?? b.deliveryAddress), {
        message: 'Choose a saved address or enter one.',
      }),
  }),
  consentHandler
);

/**
 * Re-quote. A prescription outlives its price quote, and re-pricing the same
 * drugs needs no clinical decision — so the patient can ask for it rather than
 * being sent back to the doctor.
 */
router.post(
  '/prescription/:prescriptionId/reorder',
  authorizeRoles('PATIENT'),
  validate({ params: z.object({ prescriptionId: uuidSchema }) }),
  requoteHandler
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
