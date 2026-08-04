import type { Response } from 'express';
import {
  requestOtpService,
  verifyOtpService,
  refreshTokensService,
  provisionRoleService,
} from '../services/authService.js';
import { startOtpCooldown } from '../middlewares/rateLimiter.js';
import { asyncHandler, type AuthenticatedRequest } from '../middlewares/auth.js';

export const requestOtpHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { phoneNumber } = req.body as { phoneNumber: string };
  const result = await requestOtpService(phoneNumber);

  // Only start the cooldown once delivery actually succeeded.
  await startOtpCooldown(result.phoneNumber);

  res.status(200).json({ success: true, ...result });
});

export const verifyOtpHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { phoneNumber, otp } = req.body as { phoneNumber: string; otp: string };
  // NOTE: `role` is deliberately not read from the body — it is resolved from
  // the database inside the service. Accepting it here allowed any caller to
  // mint an ADMIN token for themselves.
  const result = await verifyOtpService(phoneNumber, otp);
  res.status(200).json({ success: true, ...result });
});

export const refreshTokenHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const result = await refreshTokensService(refreshToken);
  res.status(200).json({ success: true, ...result });
});

export const provisionRoleHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { phoneNumber, role, ...profile } = req.body as any;
  const user = await provisionRoleService(phoneNumber, role, profile);
  res.status(201).json({ success: true, message: `Provisioned ${role}.`, user });
});
