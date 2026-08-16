import type { Request, Response } from 'express';
import { isProduction } from '../config/env.js';

/**
 * Where a browser keeps its refresh token.
 *
 * The admin panel held both tokens in `localStorage`, which any script running
 * on the page can read. That is the whole attack: one XSS in a dependency, one
 * injected string rendered without escaping, and the refresh token walks — and
 * a refresh token is a seven-day key to an account that can read every patient
 * record on the platform. The access token expiring in fifteen minutes is no
 * comfort when the thief can mint a new one all week.
 *
 * An httpOnly cookie is not readable from JavaScript at all, so the same XSS
 * can act as the admin only while the page is open, and takes nothing with it.
 *
 * The mobile apps are unaffected and stay on the request body: they store
 * tokens in the OS keychain, which is already better than either option here,
 * and they have no cookie jar to rely on.
 */

const REFRESH_COOKIE = 'hb_refresh';

/** Days must match JWT_REFRESH_EXPIRES_IN, or the cookie outlives the token. */
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Only over TLS in production; plain http in dev, where there is none.
    secure: isProduction,
    /**
     * `strict` would drop the cookie on any cross-site navigation into the
     * panel, logging admins out whenever they arrive from a link. `lax` still
     * withholds it from the cross-site POSTs that CSRF depends on.
     */
    sameSite: 'lax',
    // Sent only to the auth endpoints that need it, never to ordinary reads.
    path: '/api/v1/auth',
    maxAge: REFRESH_MAX_AGE_MS,
  });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
};

/**
 * The cookie wins when both are present.
 *
 * A browser sends its cookie automatically, so a body value arriving alongside
 * it came from script — exactly the thing the cookie exists to stop mattering.
 */
export const readRefreshToken = (req: Request): string | null => {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (fromCookie) return fromCookie;

  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null;
};
