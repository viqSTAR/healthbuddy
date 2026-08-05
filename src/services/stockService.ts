import type { Prisma, StockMovementReason } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { logger } from '../utils/logger.js';

/**
 * Stock as a ledger.
 *
 * `PharmacyInventory.stock` is a running total, never something a shop types
 * over. Every change is a `StockMovement` carrying a reason, so "we are 40
 * boxes short" has an answer: 25 expired, 10 sold at the counter, 5 damaged in
 * a failed cold chain. A bare editable number cannot answer that, and in a
 * pharmacy the answer is the point — expired stock that quietly disappears from
 * a count is expired stock nobody investigated.
 *
 * Two quantities matter:
 *
 *   stock     — physically on the shelf
 *   reserved  — promised to paid orders not yet dispatched
 *   available — stock − reserved, which is what may be sold
 *
 * Without `reserved`, two customers can be sold the last box: the first order
 * is paid but not yet packed, so nothing has been deducted yet.
 */

/** Reasons a partner may record by hand. The rest are system-generated. */
export const MANUAL_REASONS = [
  'PURCHASE',
  'CORRECTION',
  'SALE_OFFLINE',
  'RETURN',
  'EXPIRED',
  'DAMAGED',
] as const satisfies readonly StockMovementReason[];

/** Reasons that must not increase stock — a write-off cannot create inventory. */
const OUTWARD_ONLY: readonly StockMovementReason[] = ['EXPIRED', 'DAMAGED', 'SALE_OFFLINE'];
const INWARD_ONLY: readonly StockMovementReason[] = ['PURCHASE', 'RETURN'];

export interface MovementInput {
  inventoryId: string;
  /** Signed. Positive is stock in, negative is stock out. */
  delta: number;
  reason: StockMovementReason;
  note?: string | null;
  batchNumber?: string | null;
  expiryDate?: Date | null;
  medicineOrderId?: string | null;
  actorUserId?: string | null;
}

/**
 * Applies one movement inside a transaction.
 *
 * The stock update is conditional on the balance the movement was calculated
 * against, so two concurrent write-offs cannot both succeed against the same
 * units and drive the shelf negative.
 */
const applyMovement = async (
  tx: Prisma.TransactionClient,
  input: MovementInput
): Promise<{ balanceAfter: number; reorderLevel: number; medicineName: string }> => {
  const item = await tx.pharmacyInventory.findUnique({
    where: { id: input.inventoryId },
    include: { medicine: { select: { name: true } } },
  });
  if (!item) throw notFound('Inventory item');

  const balanceAfter = item.stock + input.delta;
  if (balanceAfter < 0) {
    throw conflict(
      `Only ${item.stock} unit(s) of ${item.medicine.name} are on the shelf — cannot remove ${Math.abs(input.delta)}.`
    );
  }

  // Reducing the shelf below what is already promised would mean cancelling
  // someone's paid order to make the numbers work.
  if (balanceAfter < item.reserved) {
    throw conflict(
      `${item.reserved} unit(s) of ${item.medicine.name} are reserved for paid orders. You can only reduce stock to ${item.reserved}.`
    );
  }

  const claimed = await tx.pharmacyInventory.updateMany({
    where: { id: item.id, stock: item.stock },
    data: {
      stock: balanceAfter,
      ...(input.batchNumber !== undefined && input.batchNumber !== null
        ? { batchNumber: input.batchNumber }
        : {}),
      ...(input.expiryDate !== undefined && input.expiryDate !== null
        ? { expiryDate: input.expiryDate }
        : {}),
    },
  });
  if (claimed.count === 0) {
    throw conflict('Stock changed while you were editing. Reopen the item and try again.');
  }

  await tx.stockMovement.create({
    data: {
      inventoryId: item.id,
      pharmacyId: item.pharmacyId,
      medicineId: item.medicineId,
      delta: input.delta,
      reason: input.reason,
      balanceAfter,
      note: input.note?.trim() || null,
      batchNumber: input.batchNumber ?? null,
      expiryDate: input.expiryDate ?? null,
      medicineOrderId: input.medicineOrderId ?? null,
      actorUserId: input.actorUserId ?? null,
    },
  });

  return {
    balanceAfter,
    reorderLevel: item.reorderLevel,
    medicineName: item.medicine.name,
  };
};

/** Warns once, on the crossing into low stock, rather than on every sale. */
const maybeWarnLowStock = async (
  pharmacyId: string,
  medicineId: string,
  medicineName: string,
  before: number,
  after: number,
  reorderLevel: number
): Promise<void> => {
  if (after > reorderLevel || before <= reorderLevel) return;

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: { userId: true },
  });
  if (!pharmacy) return;

  await notify({
    userId: pharmacy.userId,
    type: 'LOW_STOCK',
    title: 'Low stock',
    body: `${medicineName} is down to ${after} unit(s).`,
    data: { medicineId, stock: after },
    appId: 'PARTNER',
  });
};

/* ------------------------------------------------------------------ *
 * Partner-facing
 * ------------------------------------------------------------------ */

export interface RecordMovementInput {
  pharmacyId: string;
  medicineId: string;
  /** Absolute quantity to remove or add, always positive. */
  quantity: number;
  reason: StockMovementReason;
  note?: string;
  batchNumber?: string;
  expiryDate?: string;
  actorUserId: string;
}

/**
 * Records a hand-entered movement.
 *
 * The caller supplies a positive quantity and a reason; the reason decides the
 * direction. That way "expired: 25" cannot be entered as +25 by mistake and
 * silently create stock that was never on the shelf.
 */
export const recordStockMovementService = async (input: RecordMovementInput) => {
  if (!(MANUAL_REASONS as readonly string[]).includes(input.reason)) {
    throw new AppError('That stock reason is set by the system, not by hand.', 400);
  }
  if (input.quantity <= 0) {
    throw new AppError('Enter how many units, as a positive number.', 400);
  }

  const item = await prisma.pharmacyInventory.findUnique({
    where: {
      pharmacyId_medicineId: { pharmacyId: input.pharmacyId, medicineId: input.medicineId },
    },
    select: { id: true, stock: true },
  });
  if (!item) throw notFound('Inventory item');

  const outward = (OUTWARD_ONLY as readonly string[]).includes(input.reason);
  const delta = outward ? -input.quantity : input.quantity;

  // A recount can go either way, so CORRECTION is handled by setStock instead.
  if (input.reason === 'CORRECTION') {
    throw new AppError('Use "set exact stock" for a recount so the difference is calculated.', 400);
  }

  const before = item.stock;

  const result = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      inventoryId: item.id,
      delta,
      reason: input.reason,
      note: input.note ?? null,
      batchNumber: input.batchNumber ?? null,
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
      actorUserId: input.actorUserId,
    })
  );

  await maybeWarnLowStock(
    input.pharmacyId,
    input.medicineId,
    result.medicineName,
    before,
    result.balanceAfter,
    result.reorderLevel
  );

  return {
    medicineId: input.medicineId,
    stock: result.balanceAfter,
    delta,
    reason: input.reason,
  };
};

/**
 * Sets stock to an exact count after a physical recount.
 *
 * Stored as the *difference*, not as an overwrite: the ledger records that 12
 * units went missing, which is the fact worth keeping. An overwrite would erase
 * it.
 */
export const setStockService = async (input: {
  pharmacyId: string;
  medicineId: string;
  countedQuantity: number;
  note?: string;
  batchNumber?: string;
  expiryDate?: string;
  actorUserId: string;
}) => {
  if (input.countedQuantity < 0) throw new AppError('A stock count cannot be negative.', 400);

  const item = await prisma.pharmacyInventory.findUnique({
    where: {
      pharmacyId_medicineId: { pharmacyId: input.pharmacyId, medicineId: input.medicineId },
    },
    select: { id: true, stock: true },
  });
  if (!item) throw notFound('Inventory item');

  const delta = input.countedQuantity - item.stock;
  if (delta === 0) {
    return { medicineId: input.medicineId, stock: item.stock, delta: 0, reason: 'CORRECTION' };
  }

  const before = item.stock;

  const result = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      inventoryId: item.id,
      delta,
      reason: 'CORRECTION',
      note: input.note ?? `Recount: ${before} → ${input.countedQuantity}`,
      batchNumber: input.batchNumber ?? null,
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
      actorUserId: input.actorUserId,
    })
  );

  await maybeWarnLowStock(
    input.pharmacyId,
    input.medicineId,
    result.medicineName,
    before,
    result.balanceAfter,
    result.reorderLevel
  );

  return {
    medicineId: input.medicineId,
    stock: result.balanceAfter,
    delta,
    reason: 'CORRECTION' as const,
  };
};

/* ------------------------------------------------------------------ *
 * Order lifecycle
 * ------------------------------------------------------------------ */

export interface OrderLine {
  medicineId: string;
  quantity: number;
}

/**
 * Holds stock for an order that has been paid for.
 *
 * Reserving rather than deducting is what keeps the shelf count honest between
 * payment and dispatch: the units are still physically there, they are just no
 * longer sellable. The conditional update makes the check-and-reserve atomic,
 * so two orders racing for the last box cannot both win.
 */
export const reserveStockForOrder = async (
  pharmacyId: string,
  lines: OrderLine[]
): Promise<{ reserved: boolean; shortfall?: string }> => {
  try {
    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const item = await tx.pharmacyInventory.findUnique({
          where: { pharmacyId_medicineId: { pharmacyId, medicineId: line.medicineId } },
          include: { medicine: { select: { name: true } } },
        });
        if (!item) throw conflict('An item in this order is no longer stocked here.');

        const available = item.stock - item.reserved;
        if (available < line.quantity) {
          throw conflict(`${item.medicine.name}: only ${Math.max(0, available)} left.`);
        }

        const claimed = await tx.pharmacyInventory.updateMany({
          where: { id: item.id, reserved: item.reserved },
          data: { reserved: item.reserved + line.quantity },
        });
        if (claimed.count === 0) {
          throw conflict(`${item.medicine.name} was just taken by another order.`);
        }
      }
    });

    return { reserved: true };
  } catch (err) {
    return { reserved: false, shortfall: (err as Error).message };
  }
};

/**
 * Dispatch: the units physically leave, so the reservation becomes a deduction.
 *
 * Reserved is reduced and stock is reduced together — doing only one would
 * either double-count the sale or leave stock permanently locked.
 */
export const consumeReservedStock = async (
  pharmacyId: string,
  lines: OrderLine[],
  medicineOrderId: string,
  actorUserId?: string
): Promise<void> => {
  try {
    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const item = await tx.pharmacyInventory.findUnique({
          where: { pharmacyId_medicineId: { pharmacyId, medicineId: line.medicineId } },
        });
        if (!item) continue;

        await tx.pharmacyInventory.update({
          where: { id: item.id },
          data: { reserved: Math.max(0, item.reserved - line.quantity) },
        });

        await applyMovement(tx, {
          inventoryId: item.id,
          delta: -Math.min(line.quantity, item.stock),
          reason: 'SALE_ONLINE',
          medicineOrderId,
          actorUserId: actorUserId ?? null,
          note: `Dispatched on order ${medicineOrderId.slice(0, 8)}`,
        });
      }
    });
  } catch (err) {
    // The goods have physically left; refusing the dispatch now would be worse
    // than a ledger that needs reconciling, so this is loud but not fatal.
    logger.error(`[stock] could not record dispatch for order ${medicineOrderId}`, err);
  }
};

/** Cancellation: the units were never sold, so put them back on the shelf. */
export const releaseReservedStock = async (
  pharmacyId: string,
  lines: OrderLine[],
  medicineOrderId: string
): Promise<void> => {
  try {
    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const item = await tx.pharmacyInventory.findUnique({
          where: { pharmacyId_medicineId: { pharmacyId, medicineId: line.medicineId } },
        });
        if (!item || item.reserved === 0) continue;

        const released = Math.min(item.reserved, line.quantity);
        await tx.pharmacyInventory.update({
          where: { id: item.id },
          data: { reserved: item.reserved - released },
        });

        // Zero delta: nothing left the shelf, but the release is worth a line in
        // the ledger so a reservation that vanished is explainable.
        await tx.stockMovement.create({
          data: {
            inventoryId: item.id,
            pharmacyId,
            medicineId: line.medicineId,
            delta: 0,
            reason: 'ORDER_CANCELLED',
            balanceAfter: item.stock,
            note: `Released ${released} reserved unit(s) from order ${medicineOrderId.slice(0, 8)}`,
            medicineOrderId,
          },
        });
      }
    });
  } catch (err) {
    logger.error(`[stock] could not release reservation for order ${medicineOrderId}`, err);
  }
};

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export const listStockMovementsService = async (params: {
  pharmacyId?: string;
  medicineId?: string;
  reason?: StockMovementReason;
  page: number;
  limit: number;
}) => {
  const where: Prisma.StockMovementWhereInput = {
    ...(params.pharmacyId ? { pharmacyId: params.pharmacyId } : {}),
    ...(params.medicineId ? { medicineId: params.medicineId } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  };

  const [total, movements] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include: {
        inventory: {
          select: {
            medicine: { select: { name: true } },
            pharmacy: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page: params.page,
    limit: params.limit,
    movements: movements.map((m) => ({
      id: m.id,
      medicineId: m.medicineId,
      medicineName: m.inventory.medicine.name,
      pharmacyId: m.pharmacyId,
      pharmacyName: m.inventory.pharmacy.name,
      delta: m.delta,
      reason: m.reason,
      balanceAfter: m.balanceAfter,
      note: m.note,
      batchNumber: m.batchNumber,
      expiryDate: m.expiryDate,
      medicineOrderId: m.medicineOrderId,
      createdAt: m.createdAt,
    })),
  };
};

/**
 * Stock that is expired or about to be.
 *
 * Dispensing an expired medicine is the failure this whole ledger exists to
 * prevent, so it gets its own query rather than being buried in a list.
 */
export const listExpiringStockService = async (pharmacyId: string, withinDays = 90) => {
  const cutoff = new Date(Date.now() + withinDays * 86_400_000);

  const items = await prisma.pharmacyInventory.findMany({
    where: {
      pharmacyId,
      stock: { gt: 0 },
      expiryDate: { not: null, lte: cutoff },
    },
    include: { medicine: { select: { name: true } } },
    orderBy: { expiryDate: 'asc' },
    take: 200,
  });

  const now = new Date();
  return items.map((item) => ({
    medicineId: item.medicineId,
    medicineName: item.medicine.name,
    stock: item.stock,
    batchNumber: item.batchNumber,
    expiryDate: item.expiryDate,
    expired: Boolean(item.expiryDate && item.expiryDate < now),
    daysLeft: item.expiryDate
      ? Math.ceil((item.expiryDate.getTime() - now.getTime()) / 86_400_000)
      : null,
  }));
};
