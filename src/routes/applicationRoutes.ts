import { Router } from 'express';
import { z } from 'zod';
import {
  saveApplicationHandler,
  submitApplicationHandler,
  getMyApplicationsHandler,
  getApplicationHandler,
  listApplicationsHandler,
  claimApplicationHandler,
  reviewApplicationHandler,
  listExpiringLicencesHandler,
} from '../controllers/applicationController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import {
  validate,
  uuidSchema,
  paginationSchema,
  latitudeSchema,
  longitudeSchema,
} from '../middlewares/validate.js';

const router = Router();

const applicationTypeSchema = z.enum(['DOCTOR', 'PHARMACY', 'LAB']);

/**
 * Note what is absent: there is no `role` field. An applicant states the kind
 * of provider they want to be, and an admin decides whether that becomes real.
 */
const draftSchema = z.object({
  type: applicationTypeSchema,

  displayName: z.string().trim().min(2, 'Name is required.').max(160),
  contactEmail: z.string().trim().email('Enter a valid email.').max(160).optional(),
  address: z.string().trim().min(5, 'Address is required.').max(400),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  pincode: z.string().trim().max(12).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),

  // ABDM registry identifiers — HPR for professionals, HFR for facilities.
  hprId: z.string().trim().max(60).optional(),
  hfrId: z.string().trim().max(60).optional(),

  // Doctor
  councilRegistrationNumber: z.string().trim().max(60).optional(),
  councilName: z.string().trim().max(160).optional(),
  qualification: z.string().trim().max(200).optional(),
  specialty: z.string().trim().max(120).optional(),
  experienceYears: z.number().int().min(0).max(70).optional(),
  consultationFee: z.number().min(0).max(100000).optional(),

  // Pharmacy
  drugLicenceNumber: z.string().trim().max(80).optional(),
  drugLicenceExpiry: z.string().trim().max(40).optional(),
  gstin: z.string().trim().max(20).optional(),
  pharmacistName: z.string().trim().max(160).optional(),
  pharmacistRegNumber: z.string().trim().max(60).optional(),

  // Lab
  labRegistrationNumber: z.string().trim().max(80).optional(),
  nablAccredited: z.boolean().optional(),
  nablCertNumber: z.string().trim().max(80).optional(),
  nablExpiry: z.string().trim().max(40).optional(),
  homeCollection: z.boolean().optional(),
});

router.use(authenticateJwt);

/* ---------- Applicant ---------- */

router.get('/mine', getMyApplicationsHandler);
router.put('/', validate({ body: draftSchema }), saveApplicationHandler);
router.post(
  '/submit',
  validate({ body: z.object({ type: applicationTypeSchema }) }),
  submitApplicationHandler
);

/* ---------- Admin review ---------- */

router.get(
  '/',
  authorizeRoles('ADMIN'),
  validate({
    query: paginationSchema.extend({
      status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
      type: applicationTypeSchema.optional(),
    }),
  }),
  listApplicationsHandler
);

router.get(
  '/licences/expiring',
  authorizeRoles('ADMIN'),
  validate({
    query: z.object({ withinDays: z.coerce.number().int().min(0).max(365).default(30) }),
  }),
  listExpiringLicencesHandler
);

router.post(
  '/:id/claim',
  authorizeRoles('ADMIN'),
  validate({ params: z.object({ id: uuidSchema }) }),
  claimApplicationHandler
);

router.post(
  '/:id/review',
  authorizeRoles('ADMIN'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z
      .object({
        decision: z.enum(['APPROVE', 'REJECT']),
        reason: z.string().trim().min(3).max(1000).optional(),
      })
      // Enforced here as well as in the service so the client gets a field-level
      // error rather than a generic 400.
      .refine((v) => v.decision === 'APPROVE' || Boolean(v.reason), {
        message: 'A reason is required when rejecting an application.',
        path: ['reason'],
      }),
  }),
  reviewApplicationHandler
);

// Mounted last so it cannot shadow the literal paths above.
router.get('/:id', validate({ params: z.object({ id: uuidSchema }) }), getApplicationHandler);

export default router;
