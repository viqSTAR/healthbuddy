import type { Response } from 'express';
import {
  requestOtpService,
  verifyOtpService,
  refreshTokensService,
  provisionRoleService,
} from '../services/authService.js';
import { startOtpCooldown } from '../middlewares/rateLimiter.js';
import { asyncHandler, type AuthenticatedRequest } from '../middlewares/auth.js';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken } from '../utils/authCookies.js';
import { AppError } from '../utils/AppError.js';

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

  /**
   * Browsers also get the refresh token as an httpOnly cookie, which is the
   * copy the admin panel uses. The body still carries it for the mobile apps,
   * which keep it in the OS keychain and have no cookie jar.
   */
  setRefreshCookie(res, result.tokens.refreshToken);
  res.status(200).json({ success: true, ...result });
});

export const refreshTokenHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const refreshToken = readRefreshToken(req);
  if (!refreshToken) {
    // Cleared rather than left to rot: a cookie that no longer refreshes is
    // just a stale credential sitting in the browser.
    clearRefreshCookie(res);
    throw new AppError('A refresh token is required.', 401);
  }

  const result = await refreshTokensService(refreshToken);
  setRefreshCookie(res, result.tokens.refreshToken);
  res.status(200).json({ success: true, ...result });
});

/** Drops the browser's refresh cookie. The access token expires on its own. */
export const logoutHandler = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  clearRefreshCookie(res);
  res.status(200).json({ success: true, message: 'Signed out.' });
});

export const provisionRoleHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { phoneNumber, role, ...profile } = req.body as any;
  const user = await provisionRoleService(phoneNumber, role, profile);
  res.status(201).json({ success: true, message: `Provisioned ${role}.`, user });
});
