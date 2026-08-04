import type { Response } from 'express';
import type { AppId } from '@prisma/client';
import {
  registerDeviceTokenService,
  unregisterDeviceTokenService,
  listNotificationsService,
  markNotificationReadService,
  markAllNotificationsReadService,
} from '../services/notificationService.js';
import { asyncHandler, requireUser, type AuthenticatedRequest } from '../middlewares/auth.js';

export const registerDeviceHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { token, appId, platform } = req.body as {
      token: string;
      appId: AppId;
      platform: string;
    };
    const device = await registerDeviceTokenService({ userId: user.userId, token, appId, platform });
    res.status(201).json({ success: true, device });
  }
);

export const unregisterDeviceHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { token } = req.body as { token: string };
    res.status(200).json({ success: true, ...(await unregisterDeviceTokenService(user.userId, token)) });
  }
);

export const listNotificationsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { page, limit, unreadOnly } = req.query as unknown as {
      page: number;
      limit: number;
      unreadOnly?: boolean;
    };
    const result = await listNotificationsService({
      userId: user.userId,
      page,
      limit,
      ...(unreadOnly !== undefined ? { unreadOnly } : {}),
    });
    res.status(200).json({ success: true, ...result });
  }
);

export const markNotificationReadHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    res.status(200).json({ success: true, ...(await markNotificationReadService(user.userId, id)) });
  }
);

export const markAllNotificationsReadHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    res.status(200).json({ success: true, ...(await markAllNotificationsReadService(user.userId)) });
  }
);
