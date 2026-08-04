import { Router } from 'express';
import { z } from 'zod';
import {
  getAdminStatsHandler,
  listUsersHandler,
  setUserSuspendedHandler,
  listAuditLogsHandler,
} from '../controllers/adminController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, paginationSchema, uuidSchema } from '../middlewares/validate.js';

const router = Router();

// authorizeRoles was previously imported here but never applied, leaving these
// endpoints open to every authenticated user.
router.use(authenticateJwt, authorizeRoles('ADMIN'));

router.get('/stats', getAdminStatsHandler);

router.get(
  '/users',
  validate({
    query: paginationSchema.extend({
      role: z.enum(['PATIENT', 'DOCTOR', 'LAB_PARTNER', 'PHARMACY', 'ADMIN']).optional(),
    }),
  }),
  listUsersHandler
);

router.patch(
  '/users/:id/suspension',
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      suspended: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }),
  }),
  setUserSuspendedHandler
);

/** The privileged-action log — role grants, application decisions, PHI reads. */
router.get(
  '/audit',
  validate({
    query: paginationSchema.extend({
      entityType: z.string().trim().max(60).optional(),
      entityId: z.string().trim().max(60).optional(),
      action: z.string().trim().max(60).optional(),
    }),
  }),
  listAuditLogsHandler
);

export default router;
