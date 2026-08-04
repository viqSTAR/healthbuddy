import { Router } from 'express';
import { z } from 'zod';
import {
  requestOtpHandler,
  verifyOtpHandler,
  refreshTokenHandler,
  provisionRoleHandler,
} from '../controllers/authController.js';
import { otpRateLimiter, otpVerifyRateLimiter } from '../middlewares/rateLimiter.js';
import { validate, phoneSchema, otpSchema } from '../middlewares/validate.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';

const router = Router();

router.post(
  '/send-otp',
  validate({ body: z.object({ phoneNumber: phoneSchema }) }),
  otpRateLimiter,
  requestOtpHandler
);

router.post(
  '/verify-otp',
  // `role` is intentionally absent: it is derived server-side from the account.
  validate({ body: z.object({ phoneNumber: phoneSchema, otp: otpSchema }) }),
  otpVerifyRateLimiter,
  verifyOtpHandler
);

router.post(
  '/refresh',
  validate({ body: z.object({ refreshToken: z.string().min(1, 'refreshToken is required.') }) }),
  refreshTokenHandler
);

// Elevated roles can only be created by an existing administrator.
router.post(
  '/provision',
  authenticateJwt,
  authorizeRoles('ADMIN'),
  validate({
    body: z.object({
      phoneNumber: phoneSchema,
      role: z.enum(['DOCTOR', 'PHARMACY', 'LAB_PARTNER', 'ADMIN']),
      name: z.string().trim().min(1).max(120),
      specialty: z.string().trim().max(80).optional(),
      consultationFee: z.number().nonnegative().max(100000).optional(),
      address: z.string().trim().max(300).optional(),
      location: z.string().trim().max(300).optional(),
    }),
  }),
  provisionRoleHandler
);

export default router;
