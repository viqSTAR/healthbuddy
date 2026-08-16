import type { OrderStatus } from '@prisma/client';
import { prisma } from '../config/db.js';
import { toNum } from '../utils/money.js';
import { AppError, notFound, conflict, forbidden } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { recordAudit } from './auditService.js';

/**
 * The rider's half of the platform.
 *
 * Two kinds of work reach an agent, and they arrive by different routes on
 * purpose. A sealed medicine parcel is commodity logistics: it sits in an open
 * pool and whoever is free takes it. Collecting a blood sample is a clinical
 * act, so it is handed out by the lab that trained the collector and never
 * appears in the pool at all.
 *
 * The rule that shapes every read here: **an unclaimed job shows no patient.**
 * The pool tells a rider where to collect, roughly where it is going, what it
 * is worth and what to collect at the door — enough to decide whether to take
 * it. The name, the phone number and the door number appear only once the job
 * is theirs, because otherwise every rider in the city could read the address
 * of every person waiting on medicine.
 */

/** Packed and waiting for someone to carry it. */
const POOL_STATUS: OrderStatus = 'PROCESSING';

const requireWorkingAgent = async (agentId: string) => {
  const agent = await prisma.deliveryAgent.findUnique({
    where: { id: agentId },
    select: { id: true, userId: true, isActive: true, verifiedAt: true, labPartnerId: true },
  });
  if (!agent) throw notFound('Agent');
  if (!agent.isActive) throw forbidden('This agent account is not active.');
  /**
   * Verification gates the work, not the account. An unverified agent can sign
   * in and see what the job looks like; they cannot take one, because taking
   * one is what discloses somebody's address.
   */
  if (!agent.verifiedAt) {
    throw forbidden('Your account is still being verified. You cannot take jobs yet.');
  }
  return agent;
};

/* ------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------ */

const agentView = {
  id: true,
  name: true,
  vehicleNumber: true,
  isActive: true,
  isAvailable: true,
  verifiedAt: true,
  labPartner: { select: { id: true, name: true } },
  serviceAreas: { select: { pincode: true }, orderBy: { pincode: 'asc' } },
} as const;

const shapeAgent = <T extends { serviceAreas: { pincode: string }[] }>(agent: T) => ({
  ...agent,
  serviceAreas: agent.serviceAreas.map((a) => a.pincode),
});

export const getMyAgentProfileService = async (agentId: string) => {
  const agent = await prisma.deliveryAgent.findUniqueOrThrow({
    where: { id: agentId },
    select: agentView,
  });
  return shapeAgent(agent);
};

/**
 * Registers the signed-in account as an agent.
 *
 * Deliberately creates an *unverified* record: anyone can ask, nobody starts
 * with access to a patient's address. `labPartnerId` is not settable here — a
 * lab decides who collects for it, an applicant does not.
 */
export const registerAgentService = async (
  userId: string,
  input: { name: string; vehicleNumber?: string; idProofNumber?: string; pincodes: string[] }
) => {
  const existing = await prisma.deliveryAgent.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) throw conflict('This account is already registered as an agent.');

  const inUse = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, doctor: { select: { id: true } }, pharmacy: { select: { id: true } }, labPartner: { select: { id: true } } },
  });
  if (inUse?.doctor || inUse?.pharmacy || inUse?.labPartner) {
    throw conflict('This account already belongs to a provider.');
  }

  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.deliveryAgent.create({
      data: {
        userId,
        name: input.name,
        vehicleNumber: input.vehicleNumber ?? null,
        idProofNumber: input.idProofNumber ?? null,
        serviceAreas: { create: dedupe(input.pincodes).map((pincode) => ({ pincode })) },
      },
      select: agentView,
    });

    await tx.user.update({ where: { id: userId }, data: { role: 'DELIVERY_AGENT' } });
    return created;
  });

  await recordAudit({
    actorUserId: userId,
    action: 'agent.registered',
    entityType: 'DeliveryAgent',
    entityId: agent.id,
  });

  return shapeAgent(agent);
};

const dedupe = (values: string[]) => [...new Set(values)];

/** Going on or off shift, and keeping the travel area current. */
export const updateMyAgentProfileService = async (
  agentId: string,
  input: { name?: string; vehicleNumber?: string; isAvailable?: boolean; pincodes?: string[] }
) => {
  const agent = await prisma.deliveryAgent.update({
    where: { id: agentId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.vehicleNumber !== undefined ? { vehicleNumber: input.vehicleNumber } : {}),
      ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
      ...(input.pincodes
        ? {
            serviceAreas: {
              deleteMany: {},
              create: dedupe(input.pincodes).map((pincode) => ({ pincode })),
            },
          }
        : {}),
    },
    select: agentView,
  });

  return shapeAgent(agent);
};

/* ------------------------------------------------------------------ *
 * The open pool
 * ------------------------------------------------------------------ */

/**
 * What an unclaimed parcel is allowed to say about itself.
 *
 * Where to collect from is a shop's business address, so it is fine. Where it
 * is going is reduced to an area — a rider deciding whether to take a job needs
 * to know it is across town, not which flat.
 */
const poolItem = (shipment: {
  id: string;
  subtotal: unknown;
  speed: string | null;
  createdAt: Date;
  items: unknown;
  pharmacy: { name: string; address: string; city: string | null; pincode: string | null };
  order: {
    pincode: string | null;
    payment: { method: string; status: string; amount: unknown } | null;
    _count: { shipments: number };
  };
}) => ({
  id: shipment.id,
  parcelValue: toNum(shipment.subtotal as number),
  itemCount: ((shipment.items as unknown[] | null) ?? []).length,
  express: shipment.speed === 'EXPRESS',
  waitingSince: shipment.createdAt,
  collectFrom: {
    name: shipment.pharmacy.name,
    address: shipment.pharmacy.address,
    city: shipment.pharmacy.city,
    pincode: shipment.pharmacy.pincode,
  },
  /** An area, not an address. The address arrives with the job. */
  deliverToPincode: shipment.order.pincode,
  partOfSplitOrder: shipment.order._count.shipments > 1,
  cashToCollect:
    shipment.order.payment?.method === 'COD' && shipment.order.payment.status !== 'PAID'
      ? toNum(shipment.order.payment.amount as number)
      : null,
});

export const getAvailableJobsService = async (agentId: string) => {
  const agent = await requireWorkingAgent(agentId);

  const areas = await prisma.deliveryAgentArea.findMany({
    where: { agentId },
    select: { pincode: true },
  });
  const pincodes = areas.map((a) => a.pincode);
  // An agent who has named no area is not "available everywhere" — they are
  // not set up. Showing them the country's parcels would be worse than empty.
  if (pincodes.length === 0) return [];

  const paymentView = { select: { method: true, status: true, amount: true } };

  const shipments = await prisma.shipment.findMany({
    where: {
      status: POOL_STATUS,
      assignedAgentUserId: null,
      order: { status: { not: 'PENDING_PAYMENT' }, pincode: { in: pincodes } },
    },
    orderBy: [{ speed: 'desc' }, { createdAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      subtotal: true,
      speed: true,
      createdAt: true,
      items: true,
      pharmacy: { select: { name: true, address: true, city: true, pincode: true } },
      order: {
        select: {
          pincode: true,
          payment: paymentView,
          fulfilment: { select: { payment: paymentView } },
          _count: { select: { shipments: true } },
        },
      },
    },
  });

  return shipments.map((s) => {
    const { fulfilment, ...order } = s.order;
    return poolItem({
      ...s,
      speed: s.speed as string | null,
      order: { ...order, payment: (order.payment ?? fulfilment?.payment ?? null) as never },
    });
  });
};

/**
 * Takes a parcel out of the pool.
 *
 * The claim is a conditional update rather than a read-then-write: two riders
 * tapping the same job at the same moment is the normal case, not the edge
 * one, and the loser must be told rather than silently sharing the job.
 */
export const claimJobService = async (agentId: string, shipmentId: string) => {
  const agent = await requireWorkingAgent(agentId);

  const claimed = await prisma.shipment.updateMany({
    where: { id: shipmentId, status: POOL_STATUS, assignedAgentUserId: null },
    data: { assignedAgentUserId: agent.userId },
  });

  if (claimed.count === 0) {
    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { assignedAgentUserId: true, status: true },
    });
    if (!existing) throw notFound('Job');
    if (existing.assignedAgentUserId) throw conflict('Another rider has already taken this job.');
    throw conflict(`This parcel is not ready for collection (it is ${existing.status.toLowerCase()}).`);
  }

  await recordAudit({
    actorUserId: agent.userId,
    action: 'agent.job_claimed',
    entityType: 'Shipment',
    entityId: shipmentId,
  });

  return getJobService(agentId, shipmentId);
};

/** Handing a job back, so it returns to the pool rather than going stale. */
export const releaseJobService = async (agentId: string, shipmentId: string) => {
  const agent = await requireWorkingAgent(agentId);

  const released = await prisma.shipment.updateMany({
    // Only before pickup: once the parcel is in the rider's bag, handing the
    // job back on the app would leave the shop's stock walking around the city.
    where: { id: shipmentId, assignedAgentUserId: agent.userId, status: POOL_STATUS },
    data: { assignedAgentUserId: null },
  });
  if (released.count === 0) {
    throw conflict('This job can no longer be handed back — it has already been collected.');
  }

  return { released: true as const };
};

/* ------------------------------------------------------------------ *
 * Jobs in hand
 * ------------------------------------------------------------------ */

const jobPayment = { select: { method: true, status: true, amount: true } };

const jobSelect = {
  id: true,
  status: true,
  subtotal: true,
  speed: true,
  items: true,
  createdAt: true,
  dispatchedAt: true,
  deliveredAt: true,
  pharmacy: { select: { name: true, address: true, city: true, pincode: true } },
  order: {
    select: {
      id: true,
      address: true,
      pincode: true,
      // Now it is theirs, so they can be told who to hand it to.
      patient: { select: { fullName: true, user: { select: { phoneNumber: true } } } },
      payment: jobPayment,
      fulfilment: { select: { payment: jobPayment } },
      _count: { select: { shipments: true } },
    },
  },
} as const;

type RawJob = {
  order: {
    fulfilment: { payment: unknown } | null;
    patient: { fullName: string | null; user: { phoneNumber: string } };
    payment: unknown;
    _count: { shipments: number };
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

const shapeJob = (row: RawJob) => {
  const { fulfilment, patient, _count, ...order } = row.order;
  const payment = (order.payment ?? fulfilment?.payment ?? null) as {
    method: string;
    status: string;
    amount: unknown;
  } | null;

  return {
    ...row,
    order: {
      ...order,
      patientName: patient.fullName,
      patientPhone: patient.user.phoneNumber,
      shipmentCount: _count.shipments,
      payment: payment
        ? { method: payment.method, status: payment.status, amount: toNum(payment.amount as number) }
        : null,
    },
    /** The one number the rider needs at the door, already decided here. */
    cashToCollect:
      payment?.method === 'COD' && payment.status !== 'PAID' ? toNum(payment.amount as number) : null,
  };
};

export const getMyJobsService = async (agentId: string) => {
  const agent = await requireWorkingAgent(agentId);

  const [shipments, pickups] = await Promise.all([
    prisma.shipment.findMany({
      where: {
        assignedAgentUserId: agent.userId,
        status: { in: ['PROCESSING', 'DISPATCHED'] },
      },
      orderBy: [{ speed: 'desc' }, { createdAt: 'asc' }],
      select: jobSelect,
    }),
    // Sample collection only reaches an agent a lab has taken on.
    agent.labPartnerId
      ? prisma.labOrder.findMany({
          where: {
            assignedAgentUserId: agent.userId,
            status: { in: ['ACCEPTED', 'SAMPLE_COLLECTED'] },
          },
          orderBy: { scheduledAt: 'asc' },
          select: {
            id: true,
            status: true,
            testName: true,
            scheduledAt: true,
            address: true,
            pincode: true,
            patient: { select: { fullName: true, user: { select: { phoneNumber: true } } } },
            labPartner: { select: { name: true, address: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    deliveries: shipments.map((s) => shapeJob(s as unknown as RawJob)),
    pickups: pickups.map(({ patient, ...rest }) => ({
      ...rest,
      patientName: patient.fullName,
      patientPhone: patient.user.phoneNumber,
    })),
  };
};

export const getJobService = async (agentId: string, shipmentId: string) => {
  const agent = await requireWorkingAgent(agentId);

  const job = await prisma.shipment.findFirst({
    // Scoped by assignment, so a job id belonging to someone else is a 404
    // rather than a 403 — job ids must not be probeable for addresses.
    where: { id: shipmentId, assignedAgentUserId: agent.userId },
    select: jobSelect,
  });
  if (!job) throw notFound('Job');

  return shapeJob(job as unknown as RawJob);
};

/* ------------------------------------------------------------------ *
 * Moving a job along
 * ------------------------------------------------------------------ */

/** What a rider may do, as opposed to what a shop may do. */
const AGENT_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PROCESSING: ['DISPATCHED'],
  DISPATCHED: ['DELIVERED'],
};

export const updateJobStatusService = async (
  agentId: string,
  shipmentId: string,
  status: OrderStatus,
  codCollected?: boolean
) => {
  const agent = await requireWorkingAgent(agentId);

  const job = await prisma.shipment.findFirst({
    where: { id: shipmentId, assignedAgentUserId: agent.userId },
    select: {
      id: true,
      status: true,
      pharmacyId: true,
      order: {
        select: {
          id: true,
          payment: jobPayment,
          fulfilment: { select: { payment: jobPayment } },
        },
      },
    },
  });
  if (!job) throw notFound('Job');

  const allowed = AGENT_TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(status)) {
    throw conflict(`A job that is ${job.status.toLowerCase()} cannot be marked ${status.toLowerCase()}.`);
  }

  /**
   * Cash is confirmed, not assumed.
   *
   * Marking a cash order delivered is what settles it, so if the rider did not
   * actually collect, the shop would be recorded as paid for money nobody has.
   * The confirmation is required rather than inferred from the tap.
   */
  const payment = job.order.payment ?? job.order.fulfilment?.payment ?? null;
  const owesCash = payment?.method === 'COD' && payment.status !== 'PAID';
  if (status === 'DELIVERED' && owesCash && codCollected !== true) {
    throw new AppError(
      `Confirm you collected ₹${toNum(payment!.amount).toFixed(2)} before marking this delivered.`,
      422
    );
  }

  // Reuses the shop's own transition so stock consumption, the order status
  // rollup, COD settlement on the last parcel and the patient's notification
  // all happen exactly once, in one place, however the parcel got moved.
  const { updateShipmentStatusService } = await import('./shipmentService.js');
  const updated = await updateShipmentStatusService(shipmentId, job.pharmacyId, status);

  await recordAudit({
    actorUserId: agent.userId,
    action: status === 'DELIVERED' ? 'agent.job_delivered' : 'agent.job_collected',
    entityType: 'Shipment',
    entityId: shipmentId,
    metadata: { codCollected: status === 'DELIVERED' ? Boolean(owesCash && codCollected) : undefined },
  });

  return updated;
};

/* ------------------------------------------------------------------ *
 * Sample collection
 * ------------------------------------------------------------------ */

export const updatePickupStatusService = async (
  agentId: string,
  labOrderId: string,
  status: 'SAMPLE_COLLECTED'
) => {
  const agent = await requireWorkingAgent(agentId);
  if (!agent.labPartnerId) {
    throw forbidden('Sample collection is only for collectors attached to a lab.');
  }

  const order = await prisma.labOrder.findFirst({
    where: { id: labOrderId, assignedAgentUserId: agent.userId },
    select: { id: true, status: true, patient: { select: { userId: true } } },
  });
  if (!order) throw notFound('Pickup');

  if (order.status !== 'ACCEPTED') {
    throw conflict(`This booking is ${order.status.toLowerCase()} — the sample cannot be collected now.`);
  }

  const updated = await prisma.labOrder.update({
    where: { id: labOrderId },
    data: { status, collectedAt: new Date() },
    select: { id: true, status: true },
  });

  await notify({
    userId: order.patient.userId,
    type: 'LAB_BOOKED',
    title: 'Sample collected',
    body: 'Your sample is on its way to the lab. The report follows once it is ready.',
    data: { labOrderId },
    appId: 'PATIENT',
  });

  await recordAudit({
    actorUserId: agent.userId,
    action: 'agent.sample_collected',
    entityType: 'LabOrder',
    entityId: labOrderId,
  });

  return updated;
};
