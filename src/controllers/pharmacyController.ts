import type { Response } from 'express';
import type { OrderStatus } from '@prisma/client';
import {
  getMedicinesService,
  placeMedicineOrderService,
  getPatientMedicineOrdersService,
  getPharmacyOrderQueueService,
  getPatientOrderByIdService,
  acceptOrderService,
  assignOrderAgentService,
  updateOrderStatusService,
  type PlaceOrderInput,
} from '../services/pharmacyService.js';
import {
  asyncHandler,
  requirePatientId,
  requirePharmacyId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const getMedicinesHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { category, query, page, limit, pincode } = req.query as unknown as {
    category?: string;
    query?: string;
    page: number;
    limit: number;
    pincode?: string;
  };
  const result = await getMedicinesService(category, query, page, limit, pincode);
  res.status(200).json({ success: true, count: result.medicines.length, ...result });
});

export const placeOrderHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const order = await placeMedicineOrderService(
    requirePatientId(req),
    req.body as PlaceOrderInput
  );
  res.status(201).json({ success: true, message: 'Order placed.', order });
});

export const getPatientOrdersHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const orders = await getPatientMedicineOrdersService(requirePatientId(req));
  res.status(200).json({ success: true, count: orders.length, orders });
});

export const getPatientOrderByIdHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const order = await getPatientOrderByIdService(id, requirePatientId(req));
    res.status(200).json({ success: true, order });
  }
);

/** PHARMACY-only: previously returned every patient's orders to any caller. */
export const getPharmacyOrderQueueHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const pharmacyId = requirePharmacyId(req);
    const { status } = req.query as unknown as { status?: OrderStatus };
    const orders = await getPharmacyOrderQueueService(pharmacyId, status);
    res.status(200).json({ success: true, count: orders.length, orders });
  }
);

export const acceptOrderHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pharmacyId = requirePharmacyId(req);
  const { id } = req.params as { id: string };
  const order = await acceptOrderService(id, pharmacyId);
  res.status(200).json({ success: true, message: 'Order accepted.', order });
});

export const assignOrderAgentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const pharmacyId = requirePharmacyId(req);
    const { id } = req.params as { id: string };
    const { agentUserId } = req.body as { agentUserId: string | null };
    const order = await assignOrderAgentService(id, pharmacyId, agentUserId);
    res.status(200).json({ success: true, order });
  }
);

export const updateOrderStatusHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pharmacyId = requirePharmacyId(req);
  const { id } = req.params as { id: string };
  const { status, cancelReason } = req.body as { status: OrderStatus; cancelReason?: string };
  const order = await updateOrderStatusService(id, pharmacyId, status, cancelReason);
  res.status(200).json({ success: true, order });
});
