import { Router } from 'express';
import { z } from 'zod';
import {
  getDoctorsHandler,
  getDoctorByIdHandler,
  getDoctorSlotsHandler,
  getMyDoctorProfileHandler,
  updateMyDoctorProfileHandler,
  getMyScheduleHandler,
  createSlotsHandler,
  deleteSlotHandler,
} from '../controllers/doctorController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, paginationSchema, uuidSchema } from '../middlewares/validate.js';

const router = Router();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use 24-hour HH:mm.');

/* ---------- Doctor app (own practice) ----------
 * Mounted before `/:id` so "me" and "schedule" are not captured as doctor ids.
 */

router.get('/me', authenticateJwt, authorizeRoles('DOCTOR'), getMyDoctorProfileHandler);

router.put(
  '/me',
  authenticateJwt,
  authorizeRoles('DOCTOR'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160).optional(),
      specialty: z.string().trim().max(120).optional(),
      qualification: z.string().trim().max(200).optional(),
      experienceYears: z.number().int().min(0).max(70).optional(),
      consultationFee: z.number().min(0).max(100000).optional(),
      about: z.string().trim().max(2000).optional(),
      languages: z.string().trim().max(200).optional(),
      clinicAddress: z.string().trim().max(400).optional(),
      isAvailable: z.boolean().optional(),
    }),
  }),
  updateMyDoctorProfileHandler
);

router.get(
  '/me/schedule',
  authenticateJwt,
  authorizeRoles('DOCTOR'),
  validate({
    query: z.object({
      from: dateSchema.default(() => new Date().toISOString().slice(0, 10)),
      to: dateSchema.default(() =>
        new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10)
      ),
    }),
  }),
  getMyScheduleHandler
);

router.post(
  '/me/slots',
  authenticateJwt,
  authorizeRoles('DOCTOR'),
  validate({
    body: z.object({
      date: dateSchema,
      startTime: timeSchema,
      endTime: timeSchema,
      slotMinutes: z.number().int().min(5).max(240).default(30),
    }),
  }),
  createSlotsHandler
);

router.delete(
  '/me/slots/:slotId',
  authenticateJwt,
  authorizeRoles('DOCTOR'),
  validate({ params: z.object({ slotId: uuidSchema }) }),
  deleteSlotHandler
);

// Public catalogue — no PHI is exposed here.
router.get(
  '/',
  validate({
    query: paginationSchema.extend({
      specialty: z.string().trim().max(80).optional(),
      query: z.string().trim().max(80).optional(),
    }),
  }),
  getDoctorsHandler
);

router.get('/:id', validate({ params: z.object({ id: uuidSchema }) }), getDoctorByIdHandler);

router.get(
  '/:id/slots',
  validate({
    params: z.object({ id: uuidSchema }),
    query: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD.')
        .default(() => new Date().toISOString().slice(0, 10)),
    }),
  }),
  getDoctorSlotsHandler
);

export default router;
