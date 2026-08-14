import { Prisma, type DeliverySpeed, type OrderStatus } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { refundForTargetService } from './paymentService.js';
import { consumeReservedStock, releaseReservedStock } from './stockService.js';

/**
 * The catalogue, optionally narrowed to one pincode.
 *
 * Without a pincode this is the reference catalogue at MRP — what the platform
 * knows about, not what anyone can buy today. With one, it becomes the shelf a
 * patient at that address can actually order from: only lines a serving shop
 * stocks, priced at the cheapest of those shops, and carrying the delivery
 * speed that area can honour.
 *
 * The two are separated because a price is meaningless without saying whose
 * shelf it came from — a listing at MRP that then charges a different amount at
 * checkout is how a store loses trust in one order.
 */
export const getMedicinesService = async (
  category?: string,
  query?: string,
  page = 1,
  limit = 20,
  pincode?: string
) => {
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
    ...(pincode
      ? {
          inventory: {
            some: {
              isActive: true,
              stock: { gt: 0 },
              pharmacy: {
                isActive: true,
                verifiedAt: { not: null },
                serviceAreas: { some: { pincode } },
              },
            },
          },
        }
      : {}),
  };

  const [medicines, total] = await Promise.all([
    prisma.medicine.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      ...(pincode
        ? {
            include: {
              inventory: {
                where: {
                  isActive: true,
                  stock: { gt: 0 },
                  pharmacy: {
                    isActive: true,
                    verifiedAt: { not: null },
                    serviceAreas: { some: { pincode } },
                  },
                },
                orderBy: { price: 'asc' },
                take: 1,
                select: {
                  price: true,
                  stock: true,
                  reserved: true,
                  pharmacy: { select: { id: true, name: true } },
                },
              },
            },
          }
        : {}),
    }),
    prisma.medicine.count({ where }),
  ]);

  if (!pincode) return { medicines, total, page, limit };

  type WithInventory = (typeof medicines)[number] & {
    inventory?: {
      price: number;
      stock: number;
      reserved: number;
      pharmacy: { id: string; name: string };
    }[];
  };

  const priced = (medicines as WithInventory[]).map((medicine) => {
    const { inventory, ...rest } = medicine;
    const best = inventory?.[0];

    return {
      ...rest,
      // The catalogue MRP stays visible so a discount is legible as a discount.
      mrp: rest.price,
      price: best?.price ?? rest.price,
      available: best ? Math.max(0, best.stock - best.reserved) : 0,
      soldBy: best?.pharmacy ?? null,
    };
  });

  return { medicines: priced, total, page, limit, pincode };
};

export interface OrderItemInput {
  medicineId: string;
  quantity: number;
}

export interface PlaceOrderInput {
  items: OrderItemInput[];
  /**
   * Either name a saved address, or pass the text and pincode directly. The
   * saved one is preferred: it is the only path that knows the pincode for
   * certain, and the pincode decides which shops may fill the order.
   */
  addressId?: string;
  address?: string;
  pincode?: string;
}

/**
 * Turns whichever address the client sent into the pair the order needs: the
 * text to deliver to, and the pincode to source from.
 *
 * The text is copied, not referenced. An address book entry can be edited or
 * deleted after the fact, and an order must always record where it was actually
 * sent — a delivery dispute is unanswerable otherwise.
 */
const resolveDeliveryAddress = async (patientId: string, input: PlaceOrderInput) => {
  if (input.addressId) {
    const saved = await prisma.address.findFirst({
      where: { id: input.addressId, patientId },
      select: {
        id: true, line1: true, line2: true, landmark: true,
        city: true, state: true, pincode: true,
      },
    });
    if (!saved) throw notFound('Address');

    const text = [saved.line1, saved.line2, saved.landmark, saved.city, saved.state, saved.pincode]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(', ');

    return { address: text, pincode: saved.pincode, addressId: saved.id };
  }

  if (!input.address) {
    throw new AppError('A delivery address is required.', 400);
  }

  return {
    address: input.address,
    ...(input.pincode ? { pincode: input.pincode } : {}),
    addressId: undefined as string | undefined,
  };
};

/**
 * Places an order, pricing it from the database and reserving stock inside a
 * transaction. Prices are never taken from the client, and the reservation uses
 * a conditional update so two concurrent orders cannot oversell the last unit.
 *
 * The basket is then split into one shipment per sourcing pharmacy. That split
 * is not a presentation choice: each line was already reserved against a
 * specific shop's shelf, so any single-pharmacy view of the order was a fiction
 * the moment a second shop supplied a line.
 */
export const placeMedicineOrderService = async (patientId: string, input: PlaceOrderInput) => {
  const { items } = input;
  const { address, pincode, addressId } = await resolveDeliveryAddress(patientId, input);

  // Refuse the whole order up front rather than letting it fail line by line
  // with an out-of-stock message that misdescribes the real problem.
  if (pincode) {
    const serving = await prisma.pharmacy.count({
      where: { isActive: true, verifiedAt: { not: null }, serviceAreas: { some: { pincode } } },
    });
    if (serving === 0) {
      throw new AppError(`We don't deliver to ${pincode} yet.`, 400);
    }
  }

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
      speed: DeliverySpeed;
    }[] = [];

    for (const item of items) {
      const med = byId.get(item.medicineId);
      if (!med) throw notFound(`Medicine ${item.medicineId}`);

      const offers = await tx.pharmacyInventory.findMany({
        where: {
          medicineId: item.medicineId,
          isActive: true,
          pharmacy: {
            isActive: true,
            // A shop that has not committed to this pincode cannot be made to
            // deliver there by having the cheapest price.
            ...(pincode ? { serviceAreas: { some: { pincode } } } : {}),
          },
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
        speed: med.deliverySpeed,
      });
    }

    // Group the lines by the shop that is actually filling them. Each group
    // becomes a shipment: its own status, its own courier, its own arrival.
    const byPharmacy = new Map<string, typeof processedItems>();
    for (const line of processedItems) {
      const lines = byPharmacy.get(line.pharmacyId);
      if (lines) lines.push(line);
      else byPharmacy.set(line.pharmacyId, [line]);
    }

    /**
     * `order.pharmacyId` stays populated with the largest supplier so the
     * partner and admin views that predate shipments keep working. It is a
     * convenience, not the truth — the shipments are.
     */
    const pharmacyId =
      [...byPharmacy.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? null;

    return tx.medicineOrder.create({
      data: {
        patientId,
        pharmacyId,
        items: processedItems as unknown as Prisma.InputJsonValue,
        totalAmount: Number(totalAmount.toFixed(2)),
        address,
        ...(pincode ? { pincode } : {}),
        ...(addressId ? { addressId } : {}),
        shipments: {
          create: [...byPharmacy.entries()].map(([shipmentPharmacyId, lines]) => ({
            pharmacyId: shipmentPharmacyId,
            items: lines as unknown as Prisma.InputJsonValue,
            subtotal: Number(lines.reduce((sum, l) => sum + l.itemTotal, 0).toFixed(2)),
            // A parcel arrives no sooner than the slowest thing in it.
            speed: lines.every((l) => l.speed === 'EXPRESS') ? 'EXPRESS' : 'STANDARD',
          })),
        },
      },
      include: { shipments: shipmentView },
    });
  });
};

const shipmentView = {
  select: {
    id: true,
    pharmacyId: true,
    items: true,
    subtotal: true,
    speed: true,
    status: true,
    acceptedAt: true,
    dispatchedAt: true,
    deliveredAt: true,
    cancelReason: true,
    createdAt: true,
    pharmacy: { select: { id: true, name: true, city: true } },
  },
} as const;

/**
 * What the order as a whole is doing, read off its parcels.
 *
 * An order is only as far along as its least advanced shipment: a patient whose
 * antibiotic is still being packed has not received their order just because the
 * paracetamol arrived. Cancelled shipments are ignored unless every one of them
 * is cancelled, so dropping one line does not read as the order being cancelled.
 */
const ORDER_STAGE_ORDER: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PROCESSING',
  'DISPATCHED',
  'DELIVERED',
];

export const deriveOrderStatus = (
  shipments: { status: OrderStatus }[],
  fallback: OrderStatus
): OrderStatus => {
  if (shipments.length === 0) return fallback;

  const live = shipments.filter((s) => s.status !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';

  return live.reduce<OrderStatus>((slowest, s) => {
    const a = ORDER_STAGE_ORDER.indexOf(slowest);
    const b = ORDER_STAGE_ORDER.indexOf(s.status);
    return b < a ? s.status : slowest;
  }, 'DELIVERED');
};

/**
 * The patient's own orders, each carrying its parcels.
 *
 * `status` is recomputed from the shipments rather than read off the order row,
 * so a list cannot show "Delivered" while a shipment is still out — the two
 * would drift the moment one shop moved and another did not.
 */
export const getPatientMedicineOrdersService = async (patientId: string) => {
  const orders = await prisma.medicineOrder.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    include: { shipments: shipmentView },
  });

  return orders.map((order) => ({
    ...order,
    status: deriveOrderStatus(order.shipments, order.status),
    shipmentCount: order.shipments.length,
  }));
};

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
  const order = await prisma.medicineOrder.findUnique({
    where: { id: orderId },
    include: { shipments: shipmentView },
  });
  // Return 404 rather than 403 so ids cannot be probed for existence.
  if (!order || order.patientId !== patientId) throw notFound('Order');

  return {
    ...order,
    status: deriveOrderStatus(order.shipments, order.status),
    shipmentCount: order.shipments.length,
  };
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

  /**
   * Stock moves against the shop that actually reserved it.
   *
   * Each line carries the pharmacy it was sourced from, so an order spanning
   * two shops is grouped before anything is released or consumed. Passing the
   * whole basket to one pharmacy — which this used to do — would try to move
   * inventory rows that shop does not have, silently leaving the real
   * reservation stranded on the other shop's shelf.
   */
  const allLines = (order.items as unknown as {
    medicineId: string;
    quantity: number;
    pharmacyId?: string;
  }[]) ?? [];

  const fillingPharmacyId = order.pharmacyId ?? pharmacyId;

  const byShop = new Map<string, { medicineId: string; quantity: number }[]>();
  for (const line of allLines) {
    if (!line.medicineId) continue;
    const shop = line.pharmacyId ?? fillingPharmacyId;
    const group = byShop.get(shop);
    const entry = { medicineId: line.medicineId, quantity: line.quantity };
    if (group) group.push(entry);
    else byShop.set(shop, [entry]);
  }

  const lines = allLines.filter((i) => i.medicineId);

  // Dispatch is when the boxes physically leave, so the reservation becomes a
  // deduction and the ledger gains a SALE_ONLINE line.
  if (status === 'DISPATCHED' && order.status !== 'DISPATCHED' && lines.length > 0) {
    for (const [shop, shopLines] of byShop) {
      await consumeReservedStock(shop, shopLines, order.id);
    }
  }

  // Cancelling is what triggers a refund. Deliberately after the status write:
  // the order is cancelled either way, and a gateway failure must not leave it
  // stuck in limbo. refundForTargetService logs and returns rather than throws.
  let refund = { refunded: false, amount: 0 };
  if (status === 'CANCELLED') {
    // Nothing was sold, so the units go back to being sellable.
    if (lines.length > 0 && order.status !== 'DISPATCHED' && order.status !== 'DELIVERED') {
      for (const [shop, shopLines] of byShop) {
        await releaseReservedStock(shop, shopLines, order.id);
      }
    }

    // Every parcel goes with the order, so none is left looking live after the
    // order it belongs to has been cancelled.
    await prisma.shipment.updateMany({
      where: { orderId: order.id, status: { notIn: ['CANCELLED', 'DELIVERED'] } },
      data: { status: 'CANCELLED', ...(cancelReason ? { cancelReason } : {}) },
    });

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
