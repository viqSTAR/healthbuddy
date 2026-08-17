import type { Response } from 'express';
import type { OrderStatus } from '@prisma/client';
import {
  getMyAgentProfileService,
  registerAgentService,
  updateMyAgentProfileService,
  getAvailableJobsService,
  claimJobService,
  releaseJobService,
  getMyJobsService,
  getJobService,
  updateJobStatusService,
  updatePickupStatusService,
  reportJobLocationService,
} from '../services/agentService.js';
import {
  asyncHandler,
  requireAgentId,
  requireUser,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const registerAgentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = requireUser(req);
    const agent = await registerAgentService(userId, req.body);
    res.status(201).json({ success: true, agent });
  }
);

export const getMyAgentProfileHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const agent = await getMyAgentProfileService(requireAgentId(req));
    res.status(200).json({ success: true, agent });
  }
);

export const updateMyAgentProfileHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const agent = await updateMyAgentProfileService(requireAgentId(req), req.body);
    res.status(200).json({ success: true, agent });
  }
);

export const getAvailableJobsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const jobs = await getAvailableJobsService(requireAgentId(req));
    res.status(200).json({ success: true, count: jobs.length, jobs });
  }
);

export const claimJobHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  const job = await claimJobService(requireAgentId(req), id);
  res.status(200).json({ success: true, job });
});

export const releaseJobHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  const result = await releaseJobService(requireAgentId(req), id);
  res.status(200).json({ success: true, ...result });
});

export const getMyJobsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const jobs = await getMyJobsService(requireAgentId(req));
  res.status(200).json({ success: true, ...jobs });
});

export const getJobHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  const job = await getJobService(requireAgentId(req), id);
  res.status(200).json({ success: true, job });
});

export const updateJobStatusHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const { status, codCollected } = req.body as {
      status: OrderStatus;
      codCollected?: boolean;
    };
    const job = await updateJobStatusService(requireAgentId(req), id, status, codCollected);
    res.status(200).json({ success: true, job });
  }
);

export const updatePickupStatusHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const pickup = await updatePickupStatusService(requireAgentId(req), id, 'SAMPLE_COLLECTED');
    res.status(200).json({ success: true, pickup });
  }
);

export const reportJobLocationHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const result = await reportJobLocationService(requireAgentId(req), id, req.body);
    res.status(200).json({ success: true, ...result });
  }
);
