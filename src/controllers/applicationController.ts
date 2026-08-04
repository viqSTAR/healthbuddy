import type { Response } from 'express';
import type { ApplicationType } from '@prisma/client';
import {
  saveApplicationService,
  submitApplicationService,
  getMyApplicationsService,
  getApplicationService,
  listApplicationsService,
  claimApplicationService,
  reviewApplicationService,
  findExpiringLicencesService,
  type ApplicationDraft,
} from '../services/applicationService.js';
import { asyncHandler, requireUser, type AuthenticatedRequest } from '../middlewares/auth.js';

export const saveApplicationHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { type, ...draft } = req.body as ApplicationDraft & { type: ApplicationType };
    const application = await saveApplicationService(user.userId, type, draft);
    res.status(200).json({ success: true, application });
  }
);

export const submitApplicationHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { type } = req.body as { type: ApplicationType };
    const application = await submitApplicationService(user.userId, type);
    res.status(200).json({
      success: true,
      message: 'Application submitted for review.',
      application,
    });
  }
);

export const getMyApplicationsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const applications = await getMyApplicationsService(user.userId);
    res.status(200).json({ success: true, applications });
  }
);

export const getApplicationHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const application = await getApplicationService(id, user);
    res.status(200).json({ success: true, application });
  }
);

/* ---------- Admin review queue ---------- */

export const listApplicationsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, status, type } = req.query as unknown as {
      page: number;
      limit: number;
      status?: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
      type?: ApplicationType;
    };
    const result = await listApplicationsService({
      page,
      limit,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    });
    res.status(200).json({ success: true, ...result });
  }
);

export const claimApplicationHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const application = await claimApplicationService(id, user.userId);
    res.status(200).json({ success: true, application });
  }
);

export const reviewApplicationHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const { decision, reason } = req.body as { decision: 'APPROVE' | 'REJECT'; reason?: string };

    const application = await reviewApplicationService({
      applicationId: id,
      adminUserId: user.userId,
      decision,
      ...(reason ? { reason } : {}),
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      success: true,
      message: decision === 'APPROVE' ? 'Application approved.' : 'Application rejected.',
      application,
    });
  }
);

export const listExpiringLicencesHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { withinDays } = req.query as unknown as { withinDays: number };
    res.status(200).json({ success: true, ...(await findExpiringLicencesService(withinDays)) });
  }
);
