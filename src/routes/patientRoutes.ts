import { Router } from 'express';
import { z } from 'zod';
import {
  getPatientProfileHandler,
  updatePatientProfileHandler,
  getMedicalRecordHandler,
  listVisitsHandler,
  getVisitHandler,
} from '../controllers/patientController.js';
import {
  listAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
  setDefaultAddressHandler,
} from '../controllers/locationController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import {
  validate,
  latitudeSchema,
  longitudeSchema,
  phoneSchema,
  uuidSchema,
} from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt, authorizeRoles('PATIENT'));

router.get('/me', getPatientProfileHandler);

router.put(
  '/me',
  // Whitelisted fields only — the old handler spread raw req.body into storage.
  validate({
    body: z
      .object({
        fullName: z.string().trim().min(1).max(120).optional(),
        email: z.email('Must be a valid email address.').nullable().optional(),
        age: z.number().int().min(0).max(130).nullable().optional(),
        gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
        bloodGroup: z
          .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
          .nullable()
          .optional(),
        emergencyContact: z.string().trim().max(20).nullable().optional(),
        address: z.string().trim().max(300).nullable().optional(),
        latitude: latitudeSchema.nullable().optional(),
        longitude: longitudeSchema.nullable().optional(),
        /**
         * Comma-separated free text. These drive condition-matched health
         * content and are what a responder reads first on an SOS, so without
         * them the targeting has nothing to work with.
         */
        allergies: z.string().trim().max(500).nullable().optional(),
        chronicConditions: z.string().trim().max(500).nullable().optional(),
      })
      .strict(),
  }),
  updatePatientProfileHandler
);

router.get('/me/records', getMedicalRecordHandler);

/**
 * Visits — the consultation and everything that came out of it.
 *
 * `/me/records` stays: it is the flat view some screens still read, and
 * removing it would break them for no gain. This is the same data organised
 * around the event rather than the table it lives in.
 */
router.get('/me/visits', listVisitsHandler);

router.get(
  '/me/visits/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  getVisitHandler
);

/* ---------- The address book ---------- */

/**
 * Pincode is required while the rest of the address is not, because it is the
 * only field the platform makes decisions from. A patient can be vague about
 * their landmark; they cannot be vague about whether we deliver there.
 */
const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode.');

const addressBody = z.object({
  label: z.enum(['HOME', 'WORK', 'OTHER']).optional(),
  // Omitted means "the account holder" — the service fills them in.
  receiverName: z.string().trim().min(2, 'Enter the name.').max(120).nullable().optional(),
  receiverPhone: phoneSchema.nullable().optional(),
  line1: z.string().trim().min(3, 'Enter the house and street.').max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  pincode: pincodeSchema,
  landmark: z.string().trim().max(120).nullable().optional(),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
});

router.get('/me/addresses', listAddressesHandler);

router.post('/me/addresses', validate({ body: addressBody.strict() }), createAddressHandler);

router.patch(
  '/me/addresses/:id',
  validate({
    params: z.object({ id: uuidSchema }),
    body: addressBody
      .partial()
      .strict()
      .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to change.' }),
  }),
  updateAddressHandler
);

router.delete(
  '/me/addresses/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  deleteAddressHandler
);

router.post(
  '/me/addresses/:id/default',
  validate({ params: z.object({ id: uuidSchema }) }),
  setDefaultAddressHandler
);

export default router;
