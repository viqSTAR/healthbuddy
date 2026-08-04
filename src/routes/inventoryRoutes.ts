import { Router } from 'express';
import { z } from 'zod';
import {
  listInventoryHandler,
  upsertInventoryHandler,
  adjustStockHandler,
  removeInventoryHandler,
  listMedicineOffersHandler,
  listOfferingsHandler,
  upsertOfferingHandler,
  removeOfferingHandler,
  listLabOffersHandler,
} from '../controllers/inventoryController.js';
import { authenticateJwt, authorizeRoles } from '../middlewares/auth.js';
import { validate, uuidSchema, paginationSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

const searchQuery = paginationSchema.extend({ search: z.string().trim().max(120).optional() });

/* ---------- Pharmacy inventory (own shop only) ---------- */

router.get(
  '/pharmacy',
  authorizeRoles('PHARMACY'),
  validate({
    query: searchQuery.extend({
      lowStockOnly: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    }),
  }),
  listInventoryHandler
);

router.put(
  '/pharmacy',
  authorizeRoles('PHARMACY'),
  validate({
    body: z.object({
      medicineId: uuidSchema,
      price: z.number().min(0).max(1000000),
      stock: z.number().int().min(0).max(1000000),
      reorderLevel: z.number().int().min(0).max(100000).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  upsertInventoryHandler
);

router.patch(
  '/pharmacy/:medicineId/stock',
  authorizeRoles('PHARMACY'),
  validate({
    params: z.object({ medicineId: uuidSchema }),
    body: z.object({ delta: z.number().int().min(-100000).max(100000) }),
  }),
  adjustStockHandler
);

router.delete(
  '/pharmacy/:medicineId',
  authorizeRoles('PHARMACY'),
  validate({ params: z.object({ medicineId: uuidSchema }) }),
  removeInventoryHandler
);

/* ---------- Lab offerings (own lab only) ---------- */

router.get(
  '/lab',
  authorizeRoles('LAB_PARTNER'),
  validate({ query: searchQuery }),
  listOfferingsHandler
);

router.put(
  '/lab',
  authorizeRoles('LAB_PARTNER'),
  validate({
    body: z.object({
      labPackageId: uuidSchema,
      price: z.number().min(0).max(1000000),
      homeCollectionFee: z.number().min(0).max(100000).optional(),
      turnaroundHours: z.number().int().min(1).max(720).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  upsertOfferingHandler
);

router.delete(
  '/lab/:labPackageId',
  authorizeRoles('LAB_PARTNER'),
  validate({ params: z.object({ labPackageId: uuidSchema }) }),
  removeOfferingHandler
);

/* ---------- Patient-facing comparison ---------- */

router.get(
  '/offers/medicine/:medicineId',
  validate({ params: z.object({ medicineId: uuidSchema }) }),
  listMedicineOffersHandler
);

router.get(
  '/offers/lab/:labPackageId',
  validate({ params: z.object({ labPackageId: uuidSchema }) }),
  listLabOffersHandler
);

export default router;
