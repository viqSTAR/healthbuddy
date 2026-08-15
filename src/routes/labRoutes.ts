import { Router } from 'express';
import { z } from 'zod';
import {
  getLabPackagesHandler,
  bookLabTestHandler,
  getPatientLabOrdersHandler,
  getPatientLabOrderByIdHandler,
  getLabQueueHandler,
  acceptLabOrderHandler,
  assignLabAgentHandler,
  attachLabReportHandler,
  updateLabOrderStatusHandler,
} from '../controllers/labController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, paginationSchema, uuidSchema } from '../middlewares/validate.js';

const router = Router();

// Public catalogue.
router.get(
  '/packages',
  validate({
    query: paginationSchema.extend({ category: z.string().trim().max(80).optional() }),
  }),
  getLabPackagesHandler
);

router.use(authenticateJwt);

router.post(
  '/book',
  authorizeRoles('PATIENT'),
  validate({
    body: z.object({
      testId: uuidSchema,
      /**
       * A saved address is preferred: it is the only form carrying a pincode
       * the platform has validated. Free text still works for a patient who
       * has not saved one.
       */
      addressId: uuidSchema.optional(),
      address: z.string().trim().max(300).optional(),
      /** Omitted means "infer from whether an address was given". */
      homeCollection: z.boolean().optional(),
    }),
  }),
  bookLabTestHandler
);

router.get('/my-orders', authorizeRoles('PATIENT'), getPatientLabOrdersHandler);

router.get(
  '/my-orders/:id',
  authorizeRoles('PATIENT'),
  validate({ params: z.object({ id: uuidSchema }) }),
  getPatientLabOrderByIdHandler
);

// LAB_PARTNER-only: both of these were previously open to any logged-in user,
// exposing all patients' lab orders and allowing forged reports.
router.get(
  '/queue',
  authorizeRoles('LAB_PARTNER'),
  validate({
    query: z.object({
      status: z
        .enum(['BOOKED', 'ACCEPTED', 'SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED'])
        .optional(),
    }),
  }),
  getLabQueueHandler
);

router.post(
  '/orders/:id/accept',
  authorizeRoles('LAB_PARTNER'),
  validate({ params: z.object({ id: uuidSchema }) }),
  acceptLabOrderHandler
);

router.patch(
  '/orders/:id/agent',
  authorizeRoles('LAB_PARTNER'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      agentUserId: uuidSchema.nullable(),
      scheduledAt: z.string().datetime().optional(),
    }),
  }),
  assignLabAgentHandler
);

/**
 * Takes a documentId rather than a URL. The file was uploaded through
 * /api/v1/files against this order, so it is stored privately and served only
 * after an ownership check.
 */
router.post(
  '/attach-report',
  authorizeRoles('LAB_PARTNER'),
  validate({ body: z.object({ orderId: uuidSchema, documentId: uuidSchema }) }),
  attachLabReportHandler
);

router.patch(
  '/orders/:id/status',
  authorizeRoles('LAB_PARTNER'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      status: z.enum([
        'BOOKED',
        'ACCEPTED',
        'SAMPLE_COLLECTED',
        'PROCESSING',
        'COMPLETED',
        'CANCELLED',
      ]),
    }),
  }),
  updateLabOrderStatusHandler
);

export default router;
