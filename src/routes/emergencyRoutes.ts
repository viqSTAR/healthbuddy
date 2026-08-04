import { Router } from 'express';
import { z } from 'zod';
import {
  triggerEmergencySOSHandler,
  getEmergencyQueueHandler,
  getMyEmergencyHistoryHandler,
  updateEmergencyStatusHandler,
} from '../controllers/emergencyController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, latitudeSchema, longitudeSchema, uuidSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

router.post(
  '/sos',
  authorizeRoles('PATIENT'),
  validate({
    body: z.object({ latitude: latitudeSchema, longitude: longitudeSchema }),
  }),
  triggerEmergencySOSHandler
);

router.get('/my-history', authorizeRoles('PATIENT'), getMyEmergencyHistoryHandler);

// ADMIN-only: this queue carries every active patient's live GPS position.
router.get('/queue', authorizeRoles('ADMIN'), getEmergencyQueueHandler);

router.patch(
  '/:id/status',
  authorizeRoles('ADMIN'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      status: z.enum(['DISPATCHED', 'EN_ROUTE', 'ARRIVED', 'RESOLVED', 'CANCELLED']),
    }),
  }),
  updateEmergencyStatusHandler
);

export default router;
