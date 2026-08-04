import { Prisma, type OrderStatus } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';

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

    let totalAmount = 0;
    const processedItems = items.map((item) => {
      const med = byId.get(item.medicineId);
      if (!med) throw notFound(`Medicine ${item.medicineId}`);
      if (med.stock < item.quantity) {
        throw conflict(`${med.name} has only ${med.stock} left in stock.`);
      }

      const itemTotal = Number((med.price * item.quantity).toFixed(2));
      totalAmount += itemTotal;

      return {
        medicineId: med.id,
        name: med.name,
        price: med.price,
        quantity: item.quantity,
        itemTotal,
      };
    });

    for (const item of items) {
      // Conditional decrement: a concurrent order that already consumed the
      // stock makes this match zero rows, so the transaction aborts.
      const updated = await tx.medicine.updateMany({
        where: { id: item.medicineId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (updated.count === 0) {
        throw conflict(`${byId.get(item.medicineId)?.name ?? 'An item'} just went out of stock.`);
      }
    }

    return tx.medicineOrder.create({
      data: {
        patientId,
        items: processedItems as unknown as Prisma.InputJsonValue,
        totalAmount: Number(totalAmount.toFixed(2)),
        address,
      },
    });
  });
};

export const getPatientMedicineOrdersService = (patientId: string) =>
  prisma.medicineOrder.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } });

/** Scoped to one pharmacy — never the whole platform's orders. */
export const getPharmacyOrderQueueService = (pharmacyId: string, status?: OrderStatus) =>
  prisma.medicineOrder.findMany({
    where: {
      OR: [{ pharmacyId }, { pharmacyId: null }],
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      patient: { select: { id: true, fullName: true, emergencyContact: true } },
      assignedAgent: { select: { id: true, phoneNumber: true } },
    },
  });

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

  await notify({
    userId: order.patient.userId,
    type: 'ORDER_STATUS_CHANGED',
    title: 'Order update',
    body: `Your order is now ${status.toLowerCase()}.`,
    data: { orderId: order.id, status },
    appId: 'PATIENT',
  });

  return updated;
};
