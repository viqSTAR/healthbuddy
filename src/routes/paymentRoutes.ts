import { Router } from 'express';
import { z } from 'zod';
import {
  checkoutHandler,
  confirmPaymentHandler,
  markCodCollectedHandler,
  listMyPaymentsHandler,
  getPaymentHandler,
  myEarningsHandler,
  mockPayHandler,
} from '../controllers/paymentController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

/* ---------- Patient ---------- */

/**
 * Start a payment.
 *
 * The body names *what* is being paid for, never how much. The amount is read
 * from the order server-side, so a tampered request cannot buy a ₹900 basket
 * for ₹9.
 */
router.post(
  '/checkout',
  authorizeRoles('PATIENT'),
  validate({
    body: z.object({
      purpose: z.enum(['MEDICINE_ORDER', 'LAB_ORDER', 'APPOINTMENT']),
      targetId: uuidSchema,
      method: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']),
    }),
  }),
  checkoutHandler
);

/** The checkout sheet's callback. Rejected unless the signature verifies. */
router.post(
  '/confirm',
  authorizeRoles('PATIENT'),
  validate({
    body: z.object({
      orderId: z.string().trim().min(4).max(120),
      paymentId: z.string().trim().min(4).max(120),
      signature: z.string().trim().min(16).max(256),
    }),
  }),
  confirmPaymentHandler
);

router.get('/mine', listMyPaymentsHandler);

/* ---------- Partner ---------- */

/** Settlement statement. Each partner sees only their own legs. */
router.get('/earnings', authorizeRoles('PHARMACY', 'LAB_PARTNER', 'DOCTOR'), myEarningsHandler);

/**
 * Cash actually arrived at the door. Restricted to the pharmacy that filled the
 * order — the service additionally accepts the agent assigned to it, which is
 * where a future rider app plugs in without changing this route.
 */
router.post(
  '/cod/:orderId/collected',
  authorizeRoles('PHARMACY'),
  validate({ params: z.object({ orderId: uuidSchema }) }),
  markCodCollectedHandler
);

/* ---------- Development ---------- */

/**
 * Stands in for the gateway's checkout sheet so the app is testable with no
 * gateway account. 404s unless PAYMENT_PROVIDER=mock, and mock is refused at
 * boot in production.
 */
router.post(
  '/:id/simulate',
  authorizeRoles('PATIENT'),
  validate({ params: z.object({ id: uuidSchema }) }),
  mockPayHandler
);

router.get('/:id', validate({ params: z.object({ id: uuidSchema }) }), getPaymentHandler);

export default router;
