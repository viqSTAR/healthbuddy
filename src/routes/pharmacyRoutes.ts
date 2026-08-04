import { Router } from 'express';
import { z } from 'zod';
import {
  getMedicinesHandler,
  placeOrderHandler,
  getPatientOrdersHandler,
  getPatientOrderByIdHandler,
  getPharmacyOrderQueueHandler,
  acceptOrderHandler,
  assignOrderAgentHandler,
  updateOrderStatusHandler,
} from '../controllers/pharmacyController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, paginationSchema, uuidSchema } from '../middlewares/validate.js';

const router = Router();

// Public catalogue.
router.get(
  '/medicines',
  validate({
    query: paginationSchema.extend({
      category: z.string().trim().max(80).optional(),
      query: z.string().trim().max(80).optional(),
    }),
  }),
  getMedicinesHandler
);

router.use(authenticateJwt);

router.post(
  '/orders',
  authorizeRoles('PATIENT'),
  validate({
    body: z.object({
      items: z
        .array(
          z.object({
            medicineId: uuidSchema,
            quantity: z.number().int().min(1, 'Quantity must be at least 1.').max(100),
          })
        )
        .min(1, 'Order must contain at least one item.')
        .max(50),
      address: z.string().trim().min(5, 'A delivery address is required.').max(300),
    }),
  }),
  placeOrderHandler
);

router.get('/my-orders', authorizeRoles('PATIENT'), getPatientOrdersHandler);

router.get(
  '/my-orders/:id',
  authorizeRoles('PATIENT'),
  validate({ params: z.object({ id: uuidSchema }) }),
  getPatientOrderByIdHandler
);

// PHARMACY-only. This previously returned every patient's orders and home
// addresses to any authenticated caller.
router.get(
  '/pharmacy-queue',
  authorizeRoles('PHARMACY'),
  validate({
    query: z.object({
      status: z
        .enum(['PLACED', 'ACCEPTED', 'PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED'])
        .optional(),
    }),
  }),
  getPharmacyOrderQueueHandler
);

router.post(
  '/orders/:id/accept',
  authorizeRoles('PHARMACY'),
  validate({ params: z.object({ id: uuidSchema }) }),
  acceptOrderHandler
);

router.patch(
  '/orders/:id/agent',
  authorizeRoles('PHARMACY'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ agentUserId: uuidSchema.nullable() }),
  }),
  assignOrderAgentHandler
);

router.patch(
  '/orders/:id/status',
  authorizeRoles('PHARMACY'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({
      status: z.enum(['PLACED', 'ACCEPTED', 'PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED']),
      cancelReason: z.string().trim().max(500).optional(),
    }),
  }),
  updateOrderStatusHandler
);

export default router;
