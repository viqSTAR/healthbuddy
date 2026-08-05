import { Prisma, type LabOrderStatus } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError, notFound, conflict } from '../utils/AppError.js';
import { notify } from './notificationService.js';
import { toPublicDocument } from './documentService.js';
import { refundForTargetService } from './paymentService.js';

export const getLabPackagesService = async (category?: string, page = 1, limit = 20) => {
  const where: Prisma.LabPackageWhereInput = category
    ? { category: { equals: category, mode: 'insensitive' } }
    : {};

  const [packages, total] = await Promise.all([
    prisma.labPackage.findMany({
      where,
      orderBy: { price: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.labPackage.count({ where }),
  ]);

  return { packages, total, page, limit };
};

/** Price is read from the catalogue, never accepted from the client. */
export const bookLabTestService = async (patientId: string, testId: string, address?: string) => {
  const pkg = await prisma.labPackage.findUnique({ where: { id: testId } });
  if (!pkg) throw notFound('Lab package');

  return prisma.labOrder.create({
    data: {
      patientId,
      testName: pkg.testName,
      price: pkg.price,
      status: 'BOOKED',
      address: address?.trim() || 'Home sample collection',
    },
    include: { patient: { select: { id: true, fullName: true } } },
  });
};

export const getPatientLabOrdersService = (patientId: string) =>
  prisma.labOrder.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } });

export const getPatientLabOrderByIdService = async (orderId: string, patientId: string) => {
  const order = await prisma.labOrder.findUnique({ where: { id: orderId } });
  if (!order || order.patientId !== patientId) throw notFound('Lab order');
  return order;
};

/**
 * Scoped to the requesting lab partner, plus not-yet-assigned orders.
 *
 * PENDING_PAYMENT never appears: a lab that sees an unpaid booking will send a
 * phlebotomist to a house for a test nobody has paid for.
 */
export const getLabQueueService = async (
  labPartnerId: string,
  status?: LabOrderStatus,
  limit = 100
) => {
  const orders = await prisma.labOrder.findMany({
    where: {
      OR: [{ labPartnerId }, { labPartnerId: null }],
      ...(status && status !== 'PENDING_PAYMENT'
        ? { status }
        : { status: { not: 'PENDING_PAYMENT' } }),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 200),
    include: {
      patient: {
        select: { id: true, fullName: true, age: true, gender: true, emergencyContact: true },
      },
      documents: true,
      assignedAgent: { select: { id: true, phoneNumber: true } },
    },
  });

  return orders.map((o) => ({ ...o, documents: o.documents.map(toPublicDocument) }));
};

/**
 * Claims an unassigned order for this lab. Uses a conditional update so two
 * labs racing on the same open booking cannot both win it.
 */
export const acceptLabOrderService = async (orderId: string, labPartnerId: string) => {
  const claimed = await prisma.labOrder.updateMany({
    where: { id: orderId, labPartnerId: null, status: 'BOOKED' },
    data: { labPartnerId, status: 'ACCEPTED' },
  });

  if (claimed.count === 0) {
    const existing = await prisma.labOrder.findUnique({
      where: { id: orderId },
      select: { labPartnerId: true },
    });
    if (!existing) throw notFound('Lab order');
    throw conflict('That booking has already been taken by another lab.');
  }

  const order = await prisma.labOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { patient: { select: { userId: true, fullName: true } } },
  });

  await notify({
    userId: order.patient.userId,
    type: 'LAB_BOOKED',
    title: 'Lab booking confirmed',
    body: `Your ${order.testName} booking has been accepted.`,
    data: { labOrderId: order.id },
    appId: 'PATIENT',
  });

  return order;
};

/** Assigns a collection agent. Partner staff today, a rider app later. */
export const assignLabAgentService = async (
  orderId: string,
  labPartnerId: string,
  agentUserId: string | null,
  scheduledAt?: string
) => {
  const order = await prisma.labOrder.findUnique({
    where: { id: orderId },
    select: { id: true, labPartnerId: true },
  });
  if (!order || order.labPartnerId !== labPartnerId) throw notFound('Lab order');

  return prisma.labOrder.update({
    where: { id: orderId },
    data: {
      assignedAgentUserId: agentUserId,
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
    },
  });
};

/**
 * Attaches a report to an order.
 *
 * Previously any authenticated user could write a reportUrl onto ANY order id
 * with no role or ownership check, which allowed forging results into another
 * patient's medical record. Now restricted to the owning lab partner, and the
 * report itself lives in authorised Document storage rather than at a public
 * URL that anyone holding the link could read.
 */
export const attachLabReportService = async (
  orderId: string,
  labPartnerId: string,
  documentId: string
) => {
  const order = await prisma.labOrder.findUnique({
    where: { id: orderId },
    include: { patient: { select: { userId: true } } },
  });
  if (!order) throw notFound('Lab order');
  if (order.labPartnerId && order.labPartnerId !== labPartnerId) throw notFound('Lab order');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, kind: true, labOrderId: true },
  });
  if (!document || document.labOrderId !== orderId) throw notFound('Document');
  if (document.kind !== 'LAB_REPORT') {
    throw new AppError('Only a LAB_REPORT document can be attached as a result.', 400);
  }

  const updated = await prisma.labOrder.update({
    where: { id: orderId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      labPartnerId: order.labPartnerId ?? labPartnerId,
    },
  });

  await notify({
    userId: order.patient.userId,
    type: 'LAB_REPORT_READY',
    title: 'Your lab report is ready',
    body: `Results for ${order.testName} are available.`,
    data: { labOrderId: order.id, documentId },
    appId: 'PATIENT',
  });

  return updated;
};

/** Timestamps that belong with each state, so the patient sees real progress. */
const LAB_STATUS_TIMESTAMPS: Partial<Record<LabOrderStatus, 'collectedAt' | 'completedAt'>> = {
  SAMPLE_COLLECTED: 'collectedAt',
  COMPLETED: 'completedAt',
};

export const updateLabOrderStatusService = async (
  orderId: string,
  labPartnerId: string,
  status: LabOrderStatus
) => {
  const order = await prisma.labOrder.findUnique({
    where: { id: orderId },
    include: { patient: { select: { userId: true } } },
  });
  if (!order) throw notFound('Lab order');
  if (order.labPartnerId && order.labPartnerId !== labPartnerId) throw notFound('Lab order');

  // Unpaid bookings leave PENDING_PAYMENT only when the money clears.
  if (order.status === 'PENDING_PAYMENT') {
    throw conflict('This booking has not been paid for yet.');
  }

  const stamp = LAB_STATUS_TIMESTAMPS[status];

  const updated = await prisma.labOrder.update({
    where: { id: orderId },
    data: {
      status,
      labPartnerId: order.labPartnerId ?? labPartnerId,
      ...(stamp ? { [stamp]: new Date() } : {}),
    },
  });

  let refund = { refunded: false, amount: 0 };
  if (status === 'CANCELLED') {
    refund = await refundForTargetService(
      order.fulfilmentId ? { fulfilmentId: order.fulfilmentId } : { labOrderId: order.id },
      'Lab booking cancelled.'
    );
  }

  await notify({
    userId: order.patient.userId,
    type: 'ORDER_STATUS_CHANGED',
    title: 'Lab booking update',
    body:
      status === 'CANCELLED' && refund.refunded
        ? `${order.testName} was cancelled. ₹${refund.amount.toFixed(2)} is being refunded.`
        : `${order.testName} is now ${status.replace(/_/g, ' ').toLowerCase()}.`,
    data: { labOrderId: order.id, status },
    appId: 'PATIENT',
  });

  return updated;
};
