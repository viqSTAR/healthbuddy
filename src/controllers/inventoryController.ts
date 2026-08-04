import type { Response } from 'express';
import {
  listPharmacyInventoryService,
  upsertInventoryItemService,
  adjustStockService,
  removeInventoryItemService,
  findMedicineOffersService,
  listLabOfferingsService,
  upsertLabOfferingService,
  removeLabOfferingService,
  findLabOffersService,
} from '../services/inventoryService.js';
import {
  asyncHandler,
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
      stock: number;
      reorderLevel?: number;
      isActive?: boolean;
    };
    const item = await upsertInventoryItemService({ pharmacyId, ...body });
    res.status(200).json({ success: true, item });
  }
);

export const adjustStockHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pharmacyId = requirePharmacyId(req);
  const { medicineId } = req.params as { medicineId: string };
  const { delta } = req.body as { delta: number };
  const item = await adjustStockService({ pharmacyId, medicineId, delta });
  res.status(200).json({ success: true, item });
});

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
      price: number;
      homeCollectionFee?: number;
      turnaroundHours?: number;
      isActive?: boolean;
    };
    const offering = await upsertLabOfferingService({ labPartnerId, ...body });
    res.status(200).json({ success: true, offering });
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
