import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import { joinConsultationService, endConsultationService } from '../services/videoService.js';
import {
  asyncHandler,
  authenticateJwt,
  authorizeRoles,
  requireUser,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

/**
 * Issues a join grant.
 *
 * No role guard: both the patient and the treating doctor need this, and the
 * service checks membership of *this* appointment, which is the real
 * authorisation. A role check here would be weaker, not stronger — every doctor
 * holds the DOCTOR role, but only one is on this consultation.
 */
router.post(
  '/:appointmentId/join',
  validate({ params: z.object({ appointmentId: uuidSchema }) }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { appointmentId } = req.params as { appointmentId: string };
    const session = await joinConsultationService({
      appointmentId,
      userId: requireUser(req).userId,
      ipAddress: req.ip ?? null,
    });
    res.status(200).json({ success: true, session });
  })
);

/** Only the treating doctor closes a consultation. */
router.post(
  '/:appointmentId/end',
  authorizeRoles('DOCTOR'),
  validate({ params: z.object({ appointmentId: uuidSchema }) }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { appointmentId } = req.params as { appointmentId: string };
    const result = await endConsultationService(appointmentId, requireUser(req).userId);
    res.status(200).json({ success: true, ...result });
  })
);

export default router;
