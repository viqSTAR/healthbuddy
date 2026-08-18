import { Router } from 'express';
import { z } from 'zod';
import {
  getMedicinesHandler,
  placeOrderHandler,
  getPatientOrdersHandler,
  getPatientOrderByIdHandler,
  getPharmacyOrderQueueHandler,
  getMyPharmacyProfileHandler,
  acceptOrderHandler,
  updateOrderStatusHandler,
} from '../controllers/pharmacyController.js';
import { checkServiceabilityHandler } from '../controllers/locationController.js';
import {
  getShipmentQueueHandler,
  acceptShipmentHandler,
  updateShipmentStatusHandler,
  assignShipmentAgentHandler,
} from '../controllers/shipmentController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, paginationSchema, uuidSchema } from '../middlewares/validate.js';

const router = Router();

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode.');

/**
 * Does anyone deliver here? Answered before the store is drawn, so a patient in
 * an area we have not reached yet is told once, plainly, instead of browsing a
 * catalogue that will refuse them at checkout.
 */
router.get(
  '/serviceability',
  validate({ query: z.object({ pincode: pincodeSchema }) }),
  checkServiceabilityHandler
);

// Public catalogue.
router.get(
  '/medicines',
  validate({
    query: paginationSchema.extend({
      category: z.string().trim().max(80).optional(),
      query: z.string().trim().max(80).optional(),
      /**
       * When given, the catalogue is restricted to what shops serving this
       * pincode actually have on the shelf, and each row carries that area's
       * real price rather than the reference MRP.
       */
      pincode: pincodeSchema.optional(),
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

      /**
       * A saved address, or a typed one. Naming a saved address is preferred —
       * it carries a pincode the platform has already validated, and the free
       * text path cannot be trusted to contain one.
       */
      addressId: uuidSchema.optional(),
      address: z.string().trim().min(5).max(300).optional(),
      pincode: pincodeSchema.optional(),
    })
      .refine((b) => Boolean(b.addressId ?? b.address), {
        message: 'Choose a saved address or enter one.',
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

/* ---------- Shipments: what a shop is actually asked to fill ---------- */

const shipmentStatus = z.enum([
  'PLACED',
  'ACCEPTED',
  'PROCESSING',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
]);

/** The shop's own profile — its licence, address and serviceability. */
router.get('/me', authorizeRoles('PHARMACY'), getMyPharmacyProfileHandler);

/**
 * The queue a partner works from. It lists shipments, not orders, because an
 * order may span several shops and no shop should be shown lines it cannot
 * fill — or worse, act on them.
 */
router.get(
  '/shipments',
  authorizeRoles('PHARMACY'),
  validate({ query: z.object({ status: shipmentStatus.optional() }) }),
  getShipmentQueueHandler
);

router.post(
  '/shipments/:id/accept',
  authorizeRoles('PHARMACY'),
  validate({ params: z.object({ id: uuidSchema }) }),
  acceptShipmentHandler
);

router.patch(
  '/shipments/:id/status',
  authorizeRoles('PHARMACY'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z
      .object({
        status: shipmentStatus,
        cancelReason: z.string().trim().min(3).max(500).optional(),
      })
      .refine((b) => b.status !== 'CANCELLED' || Boolean(b.cancelReason), {
        message: 'A reason is required when cancelling.',
      }),
  }),
  updateShipmentStatusHandler
);

router.patch(
  '/shipments/:id/agent',
  authorizeRoles('PHARMACY'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ agentUserId: uuidSchema.nullable() }),
  }),
  assignShipmentAgentHandler
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
