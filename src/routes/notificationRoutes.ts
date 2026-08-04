import { Router } from 'express';
import { z } from 'zod';
import {
  registerDeviceHandler,
  unregisterDeviceHandler,
  listNotificationsHandler,
  markNotificationReadHandler,
  markAllNotificationsReadHandler,
} from '../controllers/notificationController.js';
import { authenticateJwt } from '../middlewares/auth.js';
import { validate, uuidSchema, paginationSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

router.post(
  '/devices',
  validate({
    body: z.object({
      token: z.string().trim().min(10).max(300),
      // Keyed by app because one person may hold both a patient and a provider
      // identity, and a booking alert should not land on the wrong device.
      appId: z.enum(['PATIENT', 'DOCTOR', 'PARTNER', 'ADMIN']),
      platform: z.enum(['ios', 'android', 'web']),
    }),
  }),
  registerDeviceHandler
);

router.delete(
  '/devices',
  validate({ body: z.object({ token: z.string().trim().min(10).max(300) }) }),
  unregisterDeviceHandler
);

router.get(
  '/',
  validate({
    query: paginationSchema.extend({
      unreadOnly: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    }),
  }),
  listNotificationsHandler
);

router.post('/read-all', markAllNotificationsReadHandler);

router.post(
  '/:id/read',
  validate({ params: z.object({ id: uuidSchema }) }),
  markNotificationReadHandler
);

export default router;
