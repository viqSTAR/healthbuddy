import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound } from '../utils/AppError.js';
import { notify } from './notificationService.js';

/**
 * Per-partner catalogue.
 *
 * `Medicine` and `LabPackage` are the canonical catalogue; the price a patient
 * actually pays and the stock actually held live here, per pharmacy and per
 * lab. Without this split two partners cannot list the same item at different
 * prices, which breaks as soon as a second partner is onboarded.
 */

/** Never sellable online under the Drugs and Cosmetics Act. */
const BLOCKED_SCHEDULES = ['SCHEDULE_X', 'NARCOTIC'] as const;

/* ---------- Pharmacy inventory ---------- */

export const listPharmacyInventoryService = async (params: {
  pharmacyId: string;
  page: number;
  limit: number;
  search?: string;
  lowStockOnly?: boolean;
}) => {
  const where: Prisma.PharmacyInventoryWhereInput = {
    pharmacyId: params.pharmacyId,
    ...(params.search
      ? { medicine: { name: { contains: params.search, mode: 'insensitive' } } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.pharmacyInventory.count({ where }),
    prisma.pharmacyInventory.findMany({
      where,
      include: { medicine: true },
      orderBy: { medicine: { name: 'asc' } },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  // Filtering by "stock below this row's own reorderLevel" is a column-to-column
  // comparison, so it is applied after the query rather than in SQL.
  const items = params.lowStockOnly ? rows.filter((r) => r.stock <= r.reorderLevel) : rows;

  return { total, page: params.page, limit: params.limit, items };
};

export const upsertInventoryItemService = async (params: {
  pharmacyId: string;
  medicineId: string;
  price: number;
  stock: number;
  reorderLevel?: number;
  isActive?: boolean;
}) => {
  const medicine = await prisma.medicine.findUnique({
    where: { id: params.medicineId },
    select: { id: true, name: true, schedule: true },
  });
  if (!medicine) throw notFound('Medicine');

  if ((BLOCKED_SCHEDULES as readonly string[]).includes(medicine.schedule)) {
    throw new AppError(
      `${medicine.name} is a ${medicine.schedule.replace('_', ' ').toLowerCase()} drug and cannot be listed for online sale.`,
      422
    );
  }

  return prisma.pharmacyInventory.upsert({
    where: {
      pharmacyId_medicineId: { pharmacyId: params.pharmacyId, medicineId: params.medicineId },
    },
    update: {
      price: params.price,
      stock: params.stock,
      ...(params.reorderLevel !== undefined ? { reorderLevel: params.reorderLevel } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    create: {
      pharmacyId: params.pharmacyId,
      medicineId: params.medicineId,
      price: params.price,
      stock: params.stock,
      ...(params.reorderLevel !== undefined ? { reorderLevel: params.reorderLevel } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    include: { medicine: true },
  });
};

/** Relative stock change, used when an order is packed or a delivery fails. */
export const adjustStockService = async (params: {
  pharmacyId: string;
  medicineId: string;
  delta: number;
}) => {
  const item = await prisma.pharmacyInventory.findUnique({
    where: {
      pharmacyId_medicineId: { pharmacyId: params.pharmacyId, medicineId: params.medicineId },
    },
    include: { medicine: { select: { name: true } }, pharmacy: { select: { userId: true } } },
  });
  if (!item) throw notFound('Inventory item');

  const next = item.stock + params.delta;
  if (next < 0) {
    throw new AppError(`Only ${item.stock} unit(s) of ${item.medicine.name} remain in stock.`, 409);
  }

  const updated = await prisma.pharmacyInventory.update({
    where: { id: item.id },
    data: { stock: next },
    include: { medicine: true },
  });

  // Warn once, on the transition into low stock, rather than on every sale.
  if (next <= updated.reorderLevel && item.stock > updated.reorderLevel) {
    await notify({
      userId: item.pharmacy.userId,
      type: 'LOW_STOCK',
      title: 'Low stock',
      body: `${updated.medicine.name} is down to ${next} unit(s).`,
      data: { medicineId: updated.medicineId, stock: next },
      appId: 'PARTNER',
    });
  }

  return updated;
};

export const removeInventoryItemService = async (pharmacyId: string, medicineId: string) => {
  const deleted = await prisma.pharmacyInventory.deleteMany({ where: { pharmacyId, medicineId } });
  if (deleted.count === 0) throw notFound('Inventory item');
  return { removed: true };
};

/**
 * Patient-facing availability: which active pharmacies stock a medicine, and at
 * what price. Ordered cheapest first.
 */
export const findMedicineOffersService = async (medicineId: string) =>
  prisma.pharmacyInventory.findMany({
    where: {
      medicineId,
      isActive: true,
      stock: { gt: 0 },
      pharmacy: { isActive: true },
    },
    select: {
      price: true,
      stock: true,
      pharmacy: { select: { id: true, name: true, city: true, deliveryRadiusKm: true } },
    },
    orderBy: { price: 'asc' },
  });

/* ---------- Lab offerings ---------- */

export const listLabOfferingsService = async (params: {
  labPartnerId: string;
  page: number;
  limit: number;
  search?: string;
}) => {
  const where: Prisma.LabOfferingWhereInput = {
    labPartnerId: params.labPartnerId,
    ...(params.search
      ? { labPackage: { testName: { contains: params.search, mode: 'insensitive' } } }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.labOffering.count({ where }),
    prisma.labOffering.findMany({
      where,
      include: { labPackage: true },
      orderBy: { labPackage: { testName: 'asc' } },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { total, page: params.page, limit: params.limit, items };
};

export const upsertLabOfferingService = async (params: {
  labPartnerId: string;
  labPackageId: string;
  price: number;
  homeCollectionFee?: number;
  turnaroundHours?: number;
  isActive?: boolean;
}) => {
  const pkg = await prisma.labPackage.findUnique({
    where: { id: params.labPackageId },
    select: { id: true },
  });
  if (!pkg) throw notFound('Lab package');

  return prisma.labOffering.upsert({
    where: {
      labPartnerId_labPackageId: {
        labPartnerId: params.labPartnerId,
        labPackageId: params.labPackageId,
      },
    },
    update: {
      price: params.price,
      ...(params.homeCollectionFee !== undefined
        ? { homeCollectionFee: params.homeCollectionFee }
        : {}),
      ...(params.turnaroundHours !== undefined ? { turnaroundHours: params.turnaroundHours } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    create: {
      labPartnerId: params.labPartnerId,
      labPackageId: params.labPackageId,
      price: params.price,
      ...(params.homeCollectionFee !== undefined
        ? { homeCollectionFee: params.homeCollectionFee }
        : {}),
      ...(params.turnaroundHours !== undefined ? { turnaroundHours: params.turnaroundHours } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    include: { labPackage: true },
  });
};

export const removeLabOfferingService = async (labPartnerId: string, labPackageId: string) => {
  const deleted = await prisma.labOffering.deleteMany({ where: { labPartnerId, labPackageId } });
  if (deleted.count === 0) throw notFound('Lab offering');
  return { removed: true };
};

/** Which labs run a test, cheapest first. */
export const findLabOffersService = async (labPackageId: string) =>
  prisma.labOffering.findMany({
    where: { labPackageId, isActive: true, labPartner: { isActive: true } },
    select: {
      price: true,
      homeCollectionFee: true,
      turnaroundHours: true,
      labPartner: {
        select: { id: true, name: true, city: true, homeCollection: true, nablAccredited: true },
      },
    },
    orderBy: { price: 'asc' },
  });
