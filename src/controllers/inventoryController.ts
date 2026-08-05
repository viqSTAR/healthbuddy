import type { Response } from 'express';
import type { StockMovementReason } from '@prisma/client';
import {
  listPharmacyInventoryService,
  upsertInventoryItemService,
  removeInventoryItemService,
  findMedicineOffersService,
  listLabOfferingsService,
  upsertLabOfferingService,
  removeLabOfferingService,
  findLabOffersService,
  listTestPricesService,
  upsertTestPriceService,
  removeTestPriceService,
} from '../services/inventoryService.js';
import {
  recordStockMovementService,
  setStockService,
  listStockMovementsService,
  listExpiringStockService,
  MANUAL_REASONS,
} from '../services/stockService.js';
import {
  asyncHandler,
  requireUser,
  requirePharmacyId,
  requireLabPartnerId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

/* ---------- Pharmacy ---------- */

export const listInventoryHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const pharmacyId = requirePharmacyId(req);
    const { page, limit, search, lowStockOnly } = req.query as unknown as {
      page: number;
      limit: number;
      search?: string;
      lowStockOnly?: boolean;
    };
    const result = await listPharmacyInventoryService({
      pharmacyId,
      page,
      limit,
      ...(search ? { search } : {}),
      ...(lowStockOnly !== undefined ? { lowStockOnly } : {}),
    });
    res.status(200).json({ success: true, ...result });
  }
);

export const upsertInventoryHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const pharmacyId = requirePharmacyId(req);
    const body = req.body as {
      medicineId: string;
      price: number;
      stock?: number;
      reorderLevel?: number;
      isActive?: boolean;
      batchNumber?: string;
      expiryDate?: string;
    };
    const item = await upsertInventoryItemService({
      pharmacyId,
      ...body,
      actorUserId: requireUser(req).userId,
    });
    res.status(200).json({ success: true, item });
  }
);

/**
 * Records a stock movement — the only way stock changes by hand.
 *
 * Quantity is always positive; the reason decides the direction. "Expired: 25"
 * cannot be fat-fingered into +25 and silently invent stock that was never on
 * the shelf.
 */
export const recordStockHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pharmacyId = requirePharmacyId(req);
  const { medicineId } = req.params as { medicineId: string };
  const body = req.body as {
    quantity: number;
    reason: StockMovementReason;
    note?: string;
    batchNumber?: string;
    expiryDate?: string;
  };

  const result = await recordStockMovementService({
    pharmacyId,
    medicineId,
    ...body,
    actorUserId: requireUser(req).userId,
  });
  res.status(200).json({ success: true, ...result });
});

/** Physical recount. Stored as the difference so the discrepancy survives. */
export const setStockHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pharmacyId = requirePharmacyId(req);
  const { medicineId } = req.params as { medicineId: string };
  const body = req.body as {
    countedQuantity: number;
    note?: string;
    batchNumber?: string;
    expiryDate?: string;
  };

  const result = await setStockService({
    pharmacyId,
    medicineId,
    ...body,
    actorUserId: requireUser(req).userId,
  });
  res.status(200).json({ success: true, ...result });
});

export const listMovementsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const pharmacyId = requirePharmacyId(req);
    const { page, limit, medicineId, reason } = req.query as unknown as {
      page: number;
      limit: number;
      medicineId?: string;
      reason?: StockMovementReason;
    };

    const result = await listStockMovementsService({
      pharmacyId,
      page,
      limit,
      ...(medicineId ? { medicineId } : {}),
      ...(reason ? { reason } : {}),
    });
    res.status(200).json({ success: true, reasons: MANUAL_REASONS, ...result });
  }
);

export const listExpiringHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const pharmacyId = requirePharmacyId(req);
    const { withinDays } = req.query as unknown as { withinDays?: number };
    const items = await listExpiringStockService(pharmacyId, withinDays ?? 90);
    res.status(200).json({ success: true, count: items.length, items });
  }
);

export const removeInventoryHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const pharmacyId = requirePharmacyId(req);
    const { medicineId } = req.params as { medicineId: string };
    res
      .status(200)
      .json({ success: true, ...(await removeInventoryItemService(pharmacyId, medicineId)) });
  }
);

export const listMedicineOffersHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { medicineId } = req.params as { medicineId: string };
    const offers = await findMedicineOffersService(medicineId);
    res.status(200).json({ success: true, count: offers.length, offers });
  }
);

/* ---------- Lab ---------- */

export const listOfferingsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const labPartnerId = requireLabPartnerId(req);
    const { page, limit, search } = req.query as unknown as {
      page: number;
      limit: number;
      search?: string;
    };
    const result = await listLabOfferingsService({
      labPartnerId,
      page,
      limit,
      ...(search ? { search } : {}),
    });
    res.status(200).json({ success: true, ...result });
  }
);

export const upsertOfferingHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const labPartnerId = requireLabPartnerId(req);
    const body = req.body as {
      labPackageId: string;
      turnaroundHours?: number;
      isActive?: boolean;
    };
    const offering = await upsertLabOfferingService({ labPartnerId, ...body });
    res.status(200).json({ success: true, offering });
  }
);

/* ---------- Admin: area price bands ---------- */

export const listTestPricesHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { labPackageId } = req.query as unknown as { labPackageId?: string };
    const prices = await listTestPricesService(labPackageId);
    res.status(200).json({ success: true, count: prices.length, prices });
  }
);

export const upsertTestPriceHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      labPackageId: string;
      state?: string;
      city?: string;
      price: number;
      homeCollectionFee?: number;
      isActive?: boolean;
      note?: string;
    };
    const price = await upsertTestPriceService(body);
    res.status(200).json({ success: true, price });
  }
);

export const removeTestPriceHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    res.status(200).json({ success: true, ...(await removeTestPriceService(id)) });
  }
);

/** Platform-wide stock oversight, so write-offs are visible rather than silent. */
export const adminMovementsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, pharmacyId, medicineId, reason } = req.query as unknown as {
      page: number;
      limit: number;
      pharmacyId?: string;
      medicineId?: string;
      reason?: StockMovementReason;
    };

    const result = await listStockMovementsService({
      page,
      limit,
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(medicineId ? { medicineId } : {}),
      ...(reason ? { reason } : {}),
    });
    res.status(200).json({ success: true, ...result });
  }
);

export const removeOfferingHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const labPartnerId = requireLabPartnerId(req);
    const { labPackageId } = req.params as { labPackageId: string };
    res
      .status(200)
      .json({ success: true, ...(await removeLabOfferingService(labPartnerId, labPackageId)) });
  }
);

export const listLabOffersHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { labPackageId } = req.params as { labPackageId: string };
    const offers = await findLabOffersService(labPackageId);
    res.status(200).json({ success: true, count: offers.length, offers });
  }
);
