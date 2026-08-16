import type { Response } from 'express';
import type { LabOrderStatus } from '@prisma/client';
import {
  getLabPackagesService,
  bookLabTestService,
  type BookLabTestInput,
  getPatientLabOrdersService,
  getPatientLabOrderByIdService,
  getLabQueueService,
  acceptLabOrderService,
  assignLabAgentService,
  attachLabReportService,
  updateLabOrderStatusService,
  getMyLabProfileService,
} from '../services/labService.js';
import {
  asyncHandler,
  requirePatientId,
  requireLabPartnerId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const getLabPackagesHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { category, page, limit } = req.query as unknown as {
    category?: string;
    page: number;
    limit: number;
  };
  const result = await getLabPackagesService(category, page, limit);
  res.status(200).json({ success: true, count: result.packages.length, ...result });
});

export const bookLabTestHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const order = await bookLabTestService(requirePatientId(req), req.body as BookLabTestInput);
  res.status(201).json({ success: true, message: 'Lab test booked.', order });
});

export const getPatientLabOrdersHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const orders = await getPatientLabOrdersService(requirePatientId(req));
    res.status(200).json({ success: true, count: orders.length, orders });
  }
);

export const getPatientLabOrderByIdHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const order = await getPatientLabOrderByIdService(id, requirePatientId(req));
    res.status(200).json({ success: true, order });
  }
);

/** LAB_PARTNER-only: previously exposed every patient's lab orders. */
export const getLabQueueHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const labPartnerId = requireLabPartnerId(req);
  const { status } = req.query as unknown as { status?: LabOrderStatus };
  const queue = await getLabQueueService(labPartnerId, status);
  res.status(200).json({ success: true, count: queue.length, queue });
});

export const acceptLabOrderHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const labPartnerId = requireLabPartnerId(req);
    const { id } = req.params as { id: string };
    const order = await acceptLabOrderService(id, labPartnerId);
    res.status(200).json({ success: true, message: 'Booking accepted.', order });
  }
);

export const assignLabAgentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const labPartnerId = requireLabPartnerId(req);
    const { id } = req.params as { id: string };
    const { agentUserId, scheduledAt } = req.body as {
      agentUserId: string | null;
      scheduledAt?: string;
    };
    const order = await assignLabAgentService(id, labPartnerId, agentUserId, scheduledAt);
    res.status(200).json({ success: true, order });
  }
);

/**
 * LAB_PARTNER-only. Previously any authenticated user could attach a report URL
 * to any order id, allowing forged results in another patient's record. The
 * report is now a Document already uploaded against this order, so it is served
 * through an authorisation check rather than from a guessable public URL.
 */
export const attachLabReportHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const labPartnerId = requireLabPartnerId(req);
    const { orderId, documentId } = req.body as { orderId: string; documentId: string };
    const order = await attachLabReportService(orderId, labPartnerId, documentId);
    res.status(200).json({ success: true, message: 'Report attached.', order });
  }
);

export const updateLabOrderStatusHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const labPartnerId = requireLabPartnerId(req);
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: LabOrderStatus };
    const order = await updateLabOrderStatusService(id, labPartnerId, status);
    res.status(200).json({ success: true, order });
  }
);

/** The signed-in lab's own record. */
export const getMyLabProfileHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const lab = await getMyLabProfileService(requireLabPartnerId(req));
    res.status(200).json({ success: true, lab });
  }
);
