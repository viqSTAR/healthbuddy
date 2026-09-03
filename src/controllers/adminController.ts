import type { Response } from 'express';
import { getAdminStatsService, listUsersService, setUserSuspendedService } from '../services/adminService.js';
import { listAuditLogsService, listAuditActionsService } from '../services/auditService.js';
import { eraseAccountService } from '../services/userLifecycleService.js';
import { enforceRetentionService } from '../services/retentionService.js';
import { asyncHandler, requireUser, type AuthenticatedRequest } from '../middlewares/auth.js';
import { AppError } from '../utils/AppError.js';

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

/** The action kinds present in the log, so the filter cannot go stale. */
export const listAuditActionsHandler = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({ success: true, actions: await listAuditActionsService() });
});

/**
 * Closing an account on the holder's behalf.
 *
 * Exists alongside the self-service route because an erasure request does not
 * always arrive through the app — it comes by email, or from a relative, or
 * from someone who can no longer sign in. The work is identical; what differs
 * is who is recorded as having done it, which is exactly what the audit entry
 * captures.
 *
 * Self-erasure through this route is refused. An administrator closing their
 * own account here would revoke their own session mid-request and, if they were
 * the only admin, leave nobody able to run the platform — the same reasoning
 * that already blocks self-suspension.
 */
export const eraseUserHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const actor = requireUser(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason?: string };

  if (actor.userId === id) {
    throw new AppError('You cannot close your own account from the admin panel.', 400);
  }

  const result = await eraseAccountService({
    userId: id,
    actorUserId: actor.userId,
    ...(reason ? { reason } : {}),
    ipAddress: req.ip ?? null,
  });

  res.status(200).json({ success: true, message: 'Account closed and anonymised.', ...result });
});

/**
 * The retention position, and the button that acts on it.
 *
 * A GET reports; a POST with `apply: true` sweeps. Two verbs rather than one
 * with a flag, because the read is something an operator should be able to look
 * at freely and the write is not.
 */
export const retentionReportHandler = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({ success: true, ...(await enforceRetentionService({ dryRun: true })) });
  }
);

export const runRetentionHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const actor = requireUser(req);
    const { apply } = req.body as { apply?: boolean };

    const report = await enforceRetentionService({
      dryRun: apply !== true,
      actorUserId: actor.userId,
    });

    res.status(200).json({ success: true, ...report });
  }
);
