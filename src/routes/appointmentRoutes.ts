import { Router } from 'express';
import { z } from 'zod';
import {
  bookAppointmentHandler,
  getPatientAppointmentsHandler,
  getDoctorAppointmentsHandler,
  cancelAppointmentHandler,
} from '../controllers/appointmentController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

router.post(
  '/book',
  authorizeRoles('PATIENT'),
  validate({
    body: z.object({
      doctorId: uuidSchema,
      slotId: uuidSchema,
      type: z.enum(['VIDEO', 'IN_PERSON']).default('VIDEO'),
      symptoms: z.string().trim().max(1000).optional(),
    }),
  }),
  bookAppointmentHandler
);

router.get('/my-appointments', authorizeRoles('PATIENT'), getPatientAppointmentsHandler);

router.patch(
  '/:id/cancel',
  authorizeRoles('PATIENT'),
  validate({ params: z.object({ id: uuidSchema }) }),
  cancelAppointmentHandler
);

// Scoped to the calling doctor's own queue.
router.get('/doctor-queue', authorizeRoles('DOCTOR'), getDoctorAppointmentsHandler);

export default router;
