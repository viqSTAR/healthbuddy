import type { Response } from 'express';
import type { OrderStatus } from '@prisma/client';
import {
  getPharmacyShipmentQueueService,
  acceptShipmentService,
  updateShipmentStatusService,
  assignShipmentAgentService,
} from '../services/shipmentService.js';
import {
  asyncHandler,
  requirePharmacyId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const getShipmentQueueHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { status } = req.query as { status?: OrderStatus };
    const shipments = await getPharmacyShipmentQueueService(requirePharmacyId(req), status);
    res.status(200).json({ success: true, count: shipments.length, shipments });
  }
);

export const acceptShipmentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const shipment = await acceptShipmentService(
      (req.params as { id: string }).id,
      requirePharmacyId(req)
    );
    res.status(200).json({ success: true, message: 'Shipment accepted.', shipment });
  }
);

export const updateShipmentStatusHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { status, cancelReason } = req.body as { status: OrderStatus; cancelReason?: string };
    const shipment = await updateShipmentStatusService(
      (req.params as { id: string }).id,
      requirePharmacyId(req),
      status,
      cancelReason
    );
    res.status(200).json({ success: true, shipment });
  }
);

export const assignShipmentAgentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { agentUserId } = req.body as { agentUserId: string | null };
    const shipment = await assignShipmentAgentService(
      (req.params as { id: string }).id,
      requirePharmacyId(req),
      agentUserId
    );
    res.status(200).json({ success: true, shipment });
  }
);
