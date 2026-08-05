import { Router } from 'express';
import { z } from 'zod';
import {
  listInventoryHandler,
  upsertInventoryHandler,
  recordStockHandler,
  setStockHandler,
  listMovementsHandler,
  listExpiringHandler,
  removeInventoryHandler,
  listMedicineOffersHandler,
  listOfferingsHandler,
  upsertOfferingHandler,
  removeOfferingHandler,
  listLabOffersHandler,
  listTestPricesHandler,
  upsertTestPriceHandler,
  removeTestPriceHandler,
  adminMovementsHandler,
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use a YYYY-MM-DD date.');

/**
 * Lists a medicine, or edits how it is listed. `stock` applies only when the
 * item is first added — after that stock moves through the ledger below, so it
 * always carries a reason.
 */
router.put(
  '/pharmacy',
  authorizeRoles('PHARMACY'),
  validate({
    body: z.object({
      medicineId: uuidSchema,
      price: z.number().min(0).max(1000000),
      stock: z.number().int().min(0).max(1000000).optional(),
      reorderLevel: z.number().int().min(0).max(100000).optional(),
      isActive: z.boolean().optional(),
      batchNumber: z.string().trim().max(60).optional(),
      expiryDate: isoDate.optional(),
    }),
  }),
  upsertInventoryHandler
);

/**
 * A hand-entered stock movement.
 *
 * `quantity` is always positive and `reason` decides the direction, so a
 * write-off cannot accidentally create stock.
 */
router.post(
  '/pharmacy/:medicineId/movements',
  authorizeRoles('PHARMACY'),
  validate({
    params: z.object({ medicineId: uuidSchema }),
    body: z.object({
      quantity: z.number().int().min(1).max(1000000),
      reason: z.enum(['PURCHASE', 'SALE_OFFLINE', 'RETURN', 'EXPIRED', 'DAMAGED']),
      note: z.string().trim().max(300).optional(),
      batchNumber: z.string().trim().max(60).optional(),
      expiryDate: isoDate.optional(),
    }),
  }),
  recordStockHandler
);

/** Physical recount. The difference is what gets recorded, not the overwrite. */
router.put(
  '/pharmacy/:medicineId/stock',
  authorizeRoles('PHARMACY'),
  validate({
    params: z.object({ medicineId: uuidSchema }),
    body: z.object({
      countedQuantity: z.number().int().min(0).max(1000000),
      note: z.string().trim().max(300).optional(),
      batchNumber: z.string().trim().max(60).optional(),
      expiryDate: isoDate.optional(),
    }),
  }),
  setStockHandler
);

router.get(
  '/pharmacy/movements',
  authorizeRoles('PHARMACY'),
  validate({
    query: paginationSchema.extend({
      medicineId: uuidSchema.optional(),
      reason: z
        .enum([
          'PURCHASE',
          'CORRECTION',
          'SALE_ONLINE',
          'SALE_OFFLINE',
          'RETURN',
          'EXPIRED',
          'DAMAGED',
          'ORDER_CANCELLED',
        ])
        .optional(),
    }),
  }),
  listMovementsHandler
);

/** Dispensing an expired medicine is the failure this ledger exists to stop. */
router.get(
  '/pharmacy/expiring',
  authorizeRoles('PHARMACY'),
  validate({
    query: z.object({ withinDays: z.coerce.number().int().min(1).max(365).optional() }),
  }),
  listExpiringHandler
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

/**
 * Declares that this lab can run a test.
 *
 * Note the absence of `price`. Which tests a lab offers depends on its
 * equipment and is genuinely its own decision; what a test costs is set per
 * area by the platform, so the same test costs the same whichever lab fulfils
 * it. Sending a price here is simply ignored.
 */
router.put(
  '/lab',
  authorizeRoles('LAB_PARTNER'),
  validate({
    body: z.object({
      labPackageId: uuidSchema,
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

/* ---------- Area price bands (admin) ---------- */

router.get(
  '/test-prices',
  validate({ query: z.object({ labPackageId: uuidSchema.optional() }) }),
  listTestPricesHandler
);

router.put(
  '/test-prices',
  authorizeRoles('ADMIN'),
  validate({
    body: z.object({
      labPackageId: uuidSchema,
      // Empty means "everywhere". A city needs its state — there is more than
      // one Hyderabad.
      state: z.string().trim().max(60).optional(),
      city: z.string().trim().max(60).optional(),
      price: z.number().min(0).max(1000000),
      homeCollectionFee: z.number().min(0).max(100000).optional(),
      isActive: z.boolean().optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  upsertTestPriceHandler
);

router.delete(
  '/test-prices/:id',
  authorizeRoles('ADMIN'),
  validate({ params: z.object({ id: uuidSchema }) }),
  removeTestPriceHandler
);

/** Platform-wide stock oversight — write-offs across every pharmacy. */
router.get(
  '/admin/movements',
  authorizeRoles('ADMIN'),
  validate({
    query: paginationSchema.extend({
      pharmacyId: uuidSchema.optional(),
      medicineId: uuidSchema.optional(),
      reason: z
        .enum([
          'PURCHASE',
          'CORRECTION',
          'SALE_ONLINE',
          'SALE_OFFLINE',
          'RETURN',
          'EXPIRED',
          'DAMAGED',
          'ORDER_CANCELLED',
        ])
        .optional(),
    }),
  }),
  adminMovementsHandler
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
