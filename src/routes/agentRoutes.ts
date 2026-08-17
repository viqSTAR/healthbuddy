import { Router } from 'express';
import { z } from 'zod';
import {
  registerAgentHandler,
  getMyAgentProfileHandler,
  updateMyAgentProfileHandler,
  getAvailableJobsHandler,
  claimJobHandler,
  releaseJobHandler,
  getMyJobsHandler,
  getJobHandler,
  updateJobStatusHandler,
  updatePickupStatusHandler,
  reportJobLocationHandler,
} from '../controllers/agentController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode.');

/**
 * Signing up as a rider.
 *
 * Open to any signed-in account rather than gated on a role, because this is
 * how the role is obtained. The record it creates is unverified, and every
 * endpoint below refuses to hand out a job until someone has checked it — a
 * job carries a patient's address.
 */
router.post(
  '/register',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      vehicleNumber: z.string().trim().max(32).optional(),
      idProofNumber: z.string().trim().max(64).optional(),
      pincodes: z.array(pincodeSchema).min(1, 'Name at least one area you will travel to.').max(40),
    }),
  }),
  registerAgentHandler
);

/* Everything past here is the rider's own working day. */
router.use(authorizeRoles('DELIVERY_AGENT'));

router.get('/me', getMyAgentProfileHandler);

router.patch(
  '/me',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      vehicleNumber: z.string().trim().max(32).optional(),
      /** Going on or off shift. */
      isAvailable: z.boolean().optional(),
      pincodes: z.array(pincodeSchema).min(1).max(40).optional(),
    }),
  }),
  updateMyAgentProfileHandler
);

/** The open pool: packed parcels in this rider's areas, with no patient on them. */
router.get('/jobs/available', getAvailableJobsHandler);

router.post(
  '/jobs/:id/claim',
  validate({ params: z.object({ id: uuidSchema }) }),
  claimJobHandler
);

router.post(
  '/jobs/:id/release',
  validate({ params: z.object({ id: uuidSchema }) }),
  releaseJobHandler
);

router.get('/jobs/mine', getMyJobsHandler);

router.get('/jobs/:id', validate({ params: z.object({ id: uuidSchema }) }), getJobHandler);

router.patch(
  '/jobs/:id/status',
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      status: z.enum(['DISPATCHED', 'DELIVERED']),
      /**
       * Required by the service before a cash order can be marked delivered.
       * Marking delivered is what settles the payment, so the rider says
       * plainly that the money is in their hand rather than it being assumed
       * from the tap.
       */
      codCollected: z.boolean().optional(),
    }),
  }),
  updateJobStatusHandler
);

/**
 * Where the rider is, while a parcel is actually in transit.
 *
 * The exact point is for operations. The customer is told place names, and only
 * when the name changes — the service decides that, not the caller, so a
 * chatty client cannot turn itself into a live tracker on somebody's doorstep.
 */
router.post(
  '/jobs/:id/location',
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      /** Reverse-geocoded on the device; the server never geocodes. */
      street: z.string().trim().max(160).optional(),
      locality: z.string().trim().max(160).optional(),
      city: z.string().trim().max(160).optional(),
    }),
  }),
  reportJobLocationHandler
);

/** Sample collection. The service refuses this unless a lab has taken them on. */
router.patch(
  '/pickups/:id/status',
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ status: z.literal('SAMPLE_COLLECTED') }),
  }),
  updatePickupStatusHandler
);

export default router;
