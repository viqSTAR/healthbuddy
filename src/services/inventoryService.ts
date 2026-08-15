import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { toNum, dec } from '../utils/money.js';
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

/**
 * Adds a medicine to a shop's shelf, or edits how it is listed.
 *
 * Note what this does NOT do on an existing item: change stock. Stock only ever
 * moves through the ledger in `stockService`, so every unit that appears or
 * disappears carries a reason. An opening quantity on a *new* item is recorded
 * as a PURCHASE, which is what it is.
 */
export const upsertInventoryItemService = async (params: {
  pharmacyId: string;
  medicineId: string;
  price: number;
  /** Opening quantity. Applied only when the item is first stocked. */
  stock?: number;
  reorderLevel?: number;
  isActive?: boolean;
  batchNumber?: string;
  expiryDate?: string;
  actorUserId?: string;
}) => {
  const medicine = await prisma.medicine.findUnique({
    where: { id: params.medicineId },
    select: { id: true, name: true, schedule: true, price: true },
  });
  if (!medicine) throw notFound('Medicine');

  if ((BLOCKED_SCHEDULES as readonly string[]).includes(medicine.schedule)) {
    throw new AppError(
      `${medicine.name} is a ${medicine.schedule.replace('_', ' ').toLowerCase()} drug and cannot be listed for online sale.`,
      422
    );
  }

  // Selling above the printed MRP is an offence under the Drugs (Prices
  // Control) Order, so the catalogue MRP is a ceiling, not a suggestion.
  if (dec(params.price).gt(medicine.price)) {
    throw new AppError(
      `${medicine.name} cannot be listed above its MRP of ₹${toNum(medicine.price).toFixed(2)}.`,
      422
    );
  }

  const existing = await prisma.pharmacyInventory.findUnique({
    where: {
      pharmacyId_medicineId: { pharmacyId: params.pharmacyId, medicineId: params.medicineId },
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.pharmacyInventory.update({
      where: { id: existing.id },
      data: {
        price: params.price,
        ...(params.reorderLevel !== undefined ? { reorderLevel: params.reorderLevel } : {}),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
        ...(params.batchNumber !== undefined ? { batchNumber: params.batchNumber } : {}),
        ...(params.expiryDate !== undefined ? { expiryDate: new Date(params.expiryDate) } : {}),
      },
      include: { medicine: true },
    });
  }

  const opening = Math.max(0, params.stock ?? 0);

  return prisma.$transaction(async (tx) => {
    const created = await tx.pharmacyInventory.create({
      data: {
        pharmacyId: params.pharmacyId,
        medicineId: params.medicineId,
        price: params.price,
        stock: opening,
        ...(params.reorderLevel !== undefined ? { reorderLevel: params.reorderLevel } : {}),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
        ...(params.batchNumber !== undefined ? { batchNumber: params.batchNumber } : {}),
        ...(params.expiryDate !== undefined ? { expiryDate: new Date(params.expiryDate) } : {}),
      },
      include: { medicine: true },
    });

    if (opening > 0) {
      await tx.stockMovement.create({
        data: {
          inventoryId: created.id,
          pharmacyId: params.pharmacyId,
          medicineId: params.medicineId,
          delta: opening,
          reason: 'PURCHASE',
          balanceAfter: opening,
          note: 'Opening stock',
          batchNumber: params.batchNumber ?? null,
          expiryDate: params.expiryDate ? new Date(params.expiryDate) : null,
          actorUserId: params.actorUserId ?? null,
        },
      });
    }

    return created;
  });
};

/**
 * Delisting is not deletion.
 *
 * The ledger is the shop's record of what it dispensed, so removing the item
 * row would take its movement history with it. Deactivating keeps the history
 * and takes the medicine out of the patient-facing catalogue, which is what
 * "remove" actually means here.
 */
export const removeInventoryItemService = async (pharmacyId: string, medicineId: string) => {
  const item = await prisma.pharmacyInventory.findUnique({
    where: { pharmacyId_medicineId: { pharmacyId, medicineId } },
    select: { id: true, reserved: true },
  });
  if (!item) throw notFound('Inventory item');

  if (item.reserved > 0) {
    throw new AppError(
      `${item.reserved} unit(s) are reserved for paid orders. Dispatch or cancel those first.`,
      409
    );
  }

  await prisma.pharmacyInventory.update({
    where: { id: item.id },
    data: { isActive: false },
  });

  return { removed: true, delisted: true };
};

/**
 * Patient-facing availability: which active pharmacies can actually supply a
 * medicine, and at what price. Cheapest first.
 *
 * Availability is stock minus what is already reserved, so a shop with three
 * boxes all promised to paid orders does not advertise them again.
 */
export const findMedicineOffersService = async (medicineId: string) => {
  const rows = await prisma.pharmacyInventory.findMany({
    where: {
      medicineId,
      isActive: true,
      stock: { gt: 0 },
      pharmacy: { isActive: true },
    },
    select: {
      price: true,
      stock: true,
      reserved: true,
      expiryDate: true,
      pharmacy: { select: { id: true, name: true, city: true, deliveryRadiusKm: true } },
    },
    orderBy: { price: 'asc' },
  });

  const now = new Date();
  return rows
    // Expired stock is not stock. It must never be offered for sale.
    .filter((r) => r.stock - r.reserved > 0 && !(r.expiryDate && r.expiryDate < now))
    .map(({ reserved, expiryDate, ...r }) => ({ ...r, available: r.stock - reserved }));
};

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

/**
 * Declares that this lab can run a test.
 *
 * Capability only — no price. Labs differ in equipment, so which tests they
 * offer is genuinely theirs to decide; what a test *costs* is not, because a
 * patient cannot judge sample handling the way they can judge a restaurant, and
 * free price competition on an invisible quality selects for the cheapest
 * handling rather than the best.
 */
export const upsertLabOfferingService = async (params: {
  labPartnerId: string;
  labPackageId: string;
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
      ...(params.turnaroundHours !== undefined ? { turnaroundHours: params.turnaroundHours } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    create: {
      labPartnerId: params.labPartnerId,
      labPackageId: params.labPackageId,
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

/* ---------- Area pricing ---------- */

export interface ResolvedTestPrice {
  price: number;
  homeCollectionFee: number;
  /** Which band supplied it, so the UI can say where the number came from. */
  source: 'CITY' | 'STATE' | 'NATIONAL' | 'CATALOGUE';
  area: string;
}

/**
 * What a test costs in one area.
 *
 * Most specific wins: an exact state+city band, then the state, then the
 * national band, then the catalogue's reference price. The final fallback is
 * what stops an unpriced area from making a test unbookable.
 */
export const resolveTestPriceService = async (
  labPackageId: string,
  area: { state?: string | null; city?: string | null }
): Promise<ResolvedTestPrice | null> => {
  const pkg = await prisma.labPackage.findUnique({
    where: { id: labPackageId },
    select: { price: true },
  });
  if (!pkg) return null;

  const state = area.state?.trim() ?? '';
  const city = area.city?.trim() ?? '';

  const bands = await prisma.labTestPrice.findMany({
    where: {
      labPackageId,
      isActive: true,
      OR: [
        ...(state && city ? [{ state, city }] : []),
        ...(state ? [{ state, city: '' }] : []),
        { state: '', city: '' },
      ],
    },
  });

  const exact = bands.find((b) => b.state === state && b.city === city && state && city);
  const stateWide = bands.find((b) => b.state === state && b.city === '' && state);
  const national = bands.find((b) => b.state === '' && b.city === '');

  const chosen = exact ?? stateWide ?? national;

  if (!chosen) {
    return {
      price: toNum(pkg.price),
      homeCollectionFee: 0,
      source: 'CATALOGUE',
      area: 'Standard rate',
    };
  }

  return {
    price: toNum(chosen.price),
    homeCollectionFee: toNum(chosen.homeCollectionFee),
    source: chosen === exact ? 'CITY' : chosen === stateWide ? 'STATE' : 'NATIONAL',
    area: chosen.city || chosen.state || 'All areas',
  };
};

/**
 * Which labs run a test, with the area price attached.
 *
 * Every lab in an area quotes the same number, so the ordering is by turnaround
 * and accreditation — the things that actually differ — rather than by price.
 */
export const findLabOffersService = async (labPackageId: string) => {
  const offerings = await prisma.labOffering.findMany({
    where: { labPackageId, isActive: true, labPartner: { isActive: true } },
    select: {
      turnaroundHours: true,
      labPartner: {
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          homeCollection: true,
          nablAccredited: true,
        },
      },
    },
    orderBy: [{ turnaroundHours: 'asc' }],
  });

  return Promise.all(
    offerings.map(async (offering) => {
      const resolved = await resolveTestPriceService(labPackageId, {
        state: offering.labPartner.state,
        city: offering.labPartner.city,
      });
      return {
        price: resolved?.price ?? 0,
        homeCollectionFee: resolved?.homeCollectionFee ?? 0,
        priceArea: resolved?.area ?? null,
        turnaroundHours: offering.turnaroundHours,
        labPartner: offering.labPartner,
      };
    })
  );
};

/* ---------- Admin: price bands ---------- */

export const listTestPricesService = async (labPackageId?: string) => {
  const rows = await prisma.labTestPrice.findMany({
    where: labPackageId ? { labPackageId } : {},
    include: { labPackage: { select: { testName: true, category: true, price: true } } },
    orderBy: [{ labPackage: { testName: 'asc' } }, { state: 'asc' }, { city: 'asc' }],
    take: 500,
  });

  return rows.map((r) => ({
    id: r.id,
    labPackageId: r.labPackageId,
    testName: r.labPackage.testName,
    category: r.labPackage.category,
    cataloguePrice: r.labPackage.price,
    state: r.state,
    city: r.city,
    scope: r.city ? `${r.city}, ${r.state}` : r.state || 'All of India',
    price: r.price,
    homeCollectionFee: r.homeCollectionFee,
    isActive: r.isActive,
    note: r.note,
    updatedAt: r.updatedAt,
  }));
};

export const upsertTestPriceService = async (params: {
  labPackageId: string;
  state?: string;
  city?: string;
  price: number;
  homeCollectionFee?: number;
  isActive?: boolean;
  note?: string;
}) => {
  const pkg = await prisma.labPackage.findUnique({
    where: { id: params.labPackageId },
    select: { id: true },
  });
  if (!pkg) throw notFound('Lab package');

  const state = params.state?.trim() ?? '';
  const city = params.city?.trim() ?? '';

  // A city band without a state is ambiguous — there is more than one Hyderabad.
  if (city && !state) {
    throw new AppError('Choose a state before setting a city-specific price.', 400);
  }

  return prisma.labTestPrice.upsert({
    where: { labPackageId_state_city: { labPackageId: params.labPackageId, state, city } },
    update: {
      price: params.price,
      ...(params.homeCollectionFee !== undefined
        ? { homeCollectionFee: params.homeCollectionFee }
        : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.note !== undefined ? { note: params.note } : {}),
    },
    create: {
      labPackageId: params.labPackageId,
      state,
      city,
      price: params.price,
      ...(params.homeCollectionFee !== undefined
        ? { homeCollectionFee: params.homeCollectionFee }
        : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.note !== undefined ? { note: params.note } : {}),
    },
  });
};

export const removeTestPriceService = async (id: string) => {
  const deleted = await prisma.labTestPrice.deleteMany({ where: { id } });
  if (deleted.count === 0) throw notFound('Price band');
  return { removed: true };
};
