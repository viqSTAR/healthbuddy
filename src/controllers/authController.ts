import type { Response } from 'express';
import {
  requestOtpService,
  verifyOtpService,
  refreshTokensService,
  provisionRoleService,
  signOutService,
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

/**
 * Ends the session for real.
 *
 * Clearing the cookie was all this used to do, which meant signing out was a
 * change of mind on one browser and nothing more: the refresh token itself
 * stayed valid for a week, and on the mobile apps — which never had a cookie —
 * sign-out revoked precisely nothing. Raising the account's token version
 * invalidates every token already issued, wherever it is.
 *
 * Answers 200 either way. A caller trying to end a session should never be told
 * "your token was already invalid" and left wondering whether they are out.
 */
export const logoutHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await signOutService(readRefreshToken(req));
  clearRefreshCookie(res);
  res.status(200).json({ success: true, message: 'Signed out.' });
});

export const provisionRoleHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { phoneNumber, role, ...profile } = req.body as any;
  const user = await provisionRoleService(phoneNumber, role, profile);
  res.status(201).json({ success: true, message: `Provisioned ${role}.`, user });
});
