import type { Response } from 'express';
import { getAdminStatsService, listUsersService, setUserSuspendedService } from '../services/adminService.js';
import { listAuditLogsService } from '../services/auditService.js';
import { asyncHandler, requireUser, type AuthenticatedRequest } from '../middlewares/auth.js';

export const getAdminStatsHandler = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const stats = await getAdminStatsService();
  res.status(200).json({ success: true, stats });
});

export const listUsersHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { role, page, limit } = req.query as unknown as {
    role?: string;
    page: number;
    limit: number;
  };
  const result = await listUsersService(role, page, limit);
  res.status(200).json({ success: true, count: result.users.length, ...result });
});

export const setUserSuspendedHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const actor = requireUser(req);
    const { id } = req.params as { id: string };
    const { suspended, reason } = req.body as { suspended: boolean; reason?: string };

    const user = await setUserSuspendedService({
      actorUserId: actor.userId,
      userId: id,
      suspended,
      ...(reason ? { reason } : {}),
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ success: true, user });
  }
);

export const listAuditLogsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, entityType, entityId, action } = req.query as unknown as {
      page: number;
      limit: number;
      entityType?: string;
      entityId?: string;
      action?: string;
    };

    const result = await listAuditLogsService({
      page,
      limit,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(action ? { action } : {}),
    });

    res.status(200).json({ success: true, ...result });
  }
);
