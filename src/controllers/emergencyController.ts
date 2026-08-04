import type { Response } from 'express';
import type { EmergencyStatus } from '@prisma/client';
import {
  triggerEmergencySOSService,
  getActiveEmergencyQueueService,
  getPatientEmergencyHistoryService,
  updateEmergencyStatusService,
} from '../services/emergencyService.js';
import { asyncHandler, requirePatientId, type AuthenticatedRequest } from '../middlewares/auth.js';

export const triggerEmergencySOSHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { latitude, longitude } = req.body as { latitude: number; longitude: number };
    const sos = await triggerEmergencySOSService(requirePatientId(req), latitude, longitude);

    res.status(201).json({
      success: true,
      message: 'Emergency services notified. Help is on the way.',
      sos,
    });
  }
);

export const getMyEmergencyHistoryHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const history = await getPatientEmergencyHistoryService(requirePatientId(req));
    res.status(200).json({ success: true, count: history.length, history });
  }
);

/**
 * ADMIN-only dispatch queue. This returns every active patient's live GPS
 * position and was previously readable by any authenticated patient.
 */
export const getEmergencyQueueHandler = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    const queue = await getActiveEmergencyQueueService();
    res.status(200).json({ success: true, count: queue.length, queue });
  }
);

export const updateEmergencyStatusHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    // Narrowed by the zod schema on the route before reaching this handler.
    const { status } = req.body as { status: EmergencyStatus };
    const sos = await updateEmergencyStatusService(id, status);
    res.status(200).json({ success: true, sos });
  }
);
