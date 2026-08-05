import { Prisma, type OrderStatus } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { refundForTargetService } from './paymentService.js';
import { consumeReservedStock, releaseReservedStock } from './stockService.js';

export const getMedicinesService = async (category?: string, query?: string, page = 1, limit = 20) => {
  const where: Prisma.MedicineWhereInput = {
    ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { category: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [medicines, total] = await Promise.all([
    prisma.medicine.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.medicine.count({ where }),
  ]);

  return { medicines, total, page, limit };
};

export interface OrderItemInput {
  medicineId: string;
  quantity: number;
}

/**
 * Places an order, pricing it from the database and decrementing stock inside a
 * transaction. Prices are never taken from the client, and the stock decrement
 * uses a conditional update so two concurrent orders cannot oversell the last unit.
 */
export const placeMedicineOrderService = async (
  patientId: string,
  items: OrderItemInput[],
  address: string
) => {
  return prisma.$transaction(async (tx) => {
    const ids = items.map((i) => i.medicineId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('Duplicate medicines in order. Combine them into one line item.', 400);
    }

    const medicines = await tx.medicine.findMany({ where: { id: { in: ids } } });
    const byId = new Map(medicines.map((m) => [m.id, m]));

    /**
     * Price and stock come from a real shop's shelf, not from the catalogue.
     *
     * The catalogue row is a reference MRP shared by every pharmacy; decrementing
     * it — which this used to do — meant one shop's sale reduced the apparent
     * stock for all of them, and drove seeded medicines to zero platform-wide.
     * Availability is per pharmacy, so the shop is chosen here.
     */
    const now = new Date();
    let totalAmount = 0;
    const processedItems: {
      medicineId: string;
      name: string;
      price: number;
      quantity: number;
      itemTotal: number;
      pharmacyId: string;
    }[] = [];

    for (const item of items) {
      const med = byId.get(item.medicineId);
      if (!med) throw notFound(`Medicine ${item.medicineId}`);

      const offers = await tx.pharmacyInventory.findMany({
        where: {
          medicineId: item.medicineId,
          isActive: true,
          pharmacy: { isActive: true },
          OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
        },
        orderBy: { price: 'asc' },
        select: { id: true, price: true, stock: true, reserved: true, pharmacyId: true },
      });

      const offer = offers.find((o) => o.stock - o.reserved >= item.quantity);
      if (!offer) {
        const best = offers.reduce((m, o) => Math.max(m, o.stock - o.reserved), 0);
        throw conflict(
          best > 0
            ? `${med.name}: only ${best} available from any nearby pharmacy.`
            : `${med.name} is out of stock nearby right now.`
        );
      }

      // Reserve rather than deduct: the boxes are still on the shelf until the
      // shop packs them, but they are no longer sellable to anyone else.
      const claimed = await tx.pharmacyInventory.updateMany({
        where: { id: offer.id, reserved: offer.reserved },
        data: { reserved: offer.reserved + item.quantity },
      });
      if (claimed.count === 0) {
        throw conflict(`${med.name} was just taken by another order.`);
      }

      const itemTotal = Number((offer.price * item.quantity).toFixed(2));
      totalAmount += itemTotal;

      processedItems.push({
        medicineId: med.id,
        name: med.name,
        price: offer.price,
        quantity: item.quantity,
        itemTotal,
        pharmacyId: offer.pharmacyId,
      });
    }

    // One shop fills the basket wherever possible; otherwise the one supplying
    // the most lines takes it.
    const byPharmacy = new Map<string, number>();
    for (const line of processedItems) {
      byPharmacy.set(line.pharmacyId, (byPharmacy.get(line.pharmacyId) ?? 0) + 1);
    }
    const pharmacyId = [...byPharmacy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return tx.medicineOrder.create({
      data: {
        patientId,
        pharmacyId,
        items: processedItems as unknown as Prisma.InputJsonValue,
        totalAmount: Number(totalAmount.toFixed(2)),
        address,
      },
    });
  });
};

export const getPatientMedicineOrdersService = (patientId: string) =>
  prisma.medicineOrder.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } });

/**
 * Scoped to one pharmacy — never the whole platform's orders.
 *
 * PENDING_PAYMENT is excluded unconditionally. A pharmacy that can see an
 * unpaid order will pick and pack it, and the platform then owes for stock
 * dispensed against a payment that may never arrive.
 */
export const getPharmacyOrderQueueService = async (
  pharmacyId: string,
  status?: OrderStatus,
  limit = 100
) => {
  const paymentView = { select: { method: true, status: true, amount: true } };

  const orders = await prisma.medicineOrder.findMany({
    where: {
      OR: [{ pharmacyId }, { pharmacyId: null }],
      ...(status && status !== 'PENDING_PAYMENT'
        ? { status }
        : { status: { not: 'PENDING_PAYMENT' } }),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 200),
    include: {
      patient: { select: { id: true, fullName: true, emergencyContact: true } },
      assignedAgent: { select: { id: true, phoneNumber: true } },
      payment: paymentView,
      // An order that came from an approved prescription is paid for as part
      // of the whole basket, so its payment hangs off the fulfilment rather
      // than the order. Without this the shop is never told to collect cash.
      fulfilment: { select: { payment: paymentView } },
    },
  });

  return orders.map(({ fulfilment, ...order }) => ({
    ...order,
    payment: order.payment ?? fulfilment?.payment ?? null,
  }));
};

export const getPatientOrderByIdService = async (orderId: string, patientId: string) => {
  const order = await prisma.medicineOrder.findUnique({ where: { id: orderId } });
  // Return 404 rather than 403 so ids cannot be probed for existence.
  if (!order || order.patientId !== patientId) throw notFound('Order');
  return order;
};

/**
 * Claims an unassigned order. The conditional update is the whole point: two
 * pharmacies polling the open queue must not both believe they won the order.
 */
export const acceptOrderService = async (orderId: string, pharmacyId: string) => {
  const claimed = await prisma.medicineOrder.updateMany({
    where: { id: orderId, pharmacyId: null, status: 'PLACED' },
    data: { pharmacyId, status: 'ACCEPTED', acceptedAt: new Date() },
  });

  if (claimed.count === 0) {
    const existing = await prisma.medicineOrder.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!existing) throw notFound('Order');
    throw conflict('That order has already been taken by another pharmacy.');
  }

  const order = await prisma.medicineOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { patient: { select: { userId: true } } },
  });

  await notify({
    userId: order.patient.userId,
    type: 'ORDER_STATUS_CHANGED',
    title: 'Order accepted',
    body: 'A pharmacy has accepted your order and is preparing it.',
    data: { orderId: order.id, status: 'ACCEPTED' },
    appId: 'PATIENT',
  });

  return order;
};

/** Assigns delivery to a staff member; a rider app can reuse this field later. */
export const assignOrderAgentService = async (
  orderId: string,
  pharmacyId: string,
  agentUserId: string | null
) => {
  const order = await prisma.medicineOrder.findUnique({
    where: { id: orderId },
    select: { id: true, pharmacyId: true },
  });
  if (!order || order.pharmacyId !== pharmacyId) throw notFound('Order');

  return prisma.medicineOrder.update({
    where: { id: orderId },
    data: { assignedAgentUserId: agentUserId },
  });
};

const ORDER_STATUS_TIMESTAMPS: Partial<Record<OrderStatus, 'dispatchedAt' | 'deliveredAt'>> = {
  DISPATCHED: 'dispatchedAt',
  DELIVERED: 'deliveredAt',
};

export const updateOrderStatusService = async (
  orderId: string,
  pharmacyId: string,
  status: OrderStatus,
  cancelReason?: string
) => {
  const order = await prisma.medicineOrder.findUnique({
    where: { id: orderId },
    include: { patient: { select: { userId: true } } },
  });
  if (!order) throw notFound('Order');
  if (order.pharmacyId && order.pharmacyId !== pharmacyId) {
    throw notFound('Order');
  }

  // An unpaid order is not the pharmacy's to advance. It becomes PLACED when
  // the payment clears — nothing else may move it out of this state.
  if (order.status === 'PENDING_PAYMENT') {
    throw conflict('This order has not been paid for yet.');
  }

  // A prescription-only order must not leave the shop without one on file.
  if (status === 'DISPATCHED') {
    const items = (order.items as unknown as { medicineId: string }[]) ?? [];
    const ids = items.map((i) => i.medicineId).filter(Boolean);
    if (ids.length) {
      const rxRequired = await prisma.medicine.count({
        where: { id: { in: ids }, requiresPrescription: true },
      });
      if (rxRequired > 0 && !order.prescriptionId) {
        throw new AppError(
          'This order contains prescription-only medicine and has no prescription attached.',
          422
        );
      }
    }
  }

  const stamp = ORDER_STATUS_TIMESTAMPS[status];

  const updated = await prisma.medicineOrder.update({
    where: { id: orderId },
    data: {
      status,
      pharmacyId: order.pharmacyId ?? pharmacyId,
      ...(stamp ? { [stamp]: new Date() } : {}),
      ...(status === 'CANCELLED' && cancelReason ? { cancelReason } : {}),
    },
  });

  const lines = ((order.items as unknown as { medicineId: string; quantity: number }[]) ?? [])
    .filter((i) => i.medicineId)
    .map((i) => ({ medicineId: i.medicineId, quantity: i.quantity }));
  const fillingPharmacyId = order.pharmacyId ?? pharmacyId;

  // Dispatch is when the boxes physically leave, so the reservation becomes a
  // deduction and the ledger gains a SALE_ONLINE line.
  if (status === 'DISPATCHED' && order.status !== 'DISPATCHED' && lines.length > 0) {
    await consumeReservedStock(fillingPharmacyId, lines, order.id);
  }

  // Cancelling is what triggers a refund. Deliberately after the status write:
  // the order is cancelled either way, and a gateway failure must not leave it
  // stuck in limbo. refundForTargetService logs and returns rather than throws.
  let refund = { refunded: false, amount: 0 };
  if (status === 'CANCELLED') {
    // Nothing was sold, so the units go back to being sellable.
    if (lines.length > 0 && order.status !== 'DISPATCHED' && order.status !== 'DELIVERED') {
      await releaseReservedStock(fillingPharmacyId, lines, order.id);
    }

    refund = await refundForTargetService(
      order.fulfilmentId ? { fulfilmentId: order.fulfilmentId } : { medicineOrderId: order.id },
      cancelReason ?? 'Order cancelled by the pharmacy.'
    );
  }

  await notify({
    userId: order.patient.userId,
    type: 'ORDER_STATUS_CHANGED',
    title: 'Order update',
    body:
      status === 'CANCELLED' && refund.refunded
        ? `Your order was cancelled. ₹${refund.amount.toFixed(2)} is being refunded.`
        : `Your order is now ${status.toLowerCase()}.`,
    data: { orderId: order.id, status },
    appId: 'PATIENT',
  });

  return updated;
};
