import type { Request, Response, NextFunction } from 'express';
import { cacheStore } from '../config/redis.js';
import { normalisePhone } from '../utils/otp.js';
import { AppError } from '../utils/AppError.js';
import { env, isTest } from '../config/env.js';

const OTP_COOLDOWN_SECONDS = 60;
const OTP_WINDOW_SECONDS = 900; // 15 minutes
const OTP_MAX_PER_WINDOW = 5;

const GLOBAL_WINDOW_SECONDS = 60;

const VERIFY_WINDOW_SECONDS = 900;
const VERIFY_MAX_PER_WINDOW = 10;

const WEBHOOK_WINDOW_SECONDS = 60;
/**
 * Generous, because a gateway retrying a backlog is a normal event and dropping
 * a real payment notification is far worse than absorbing some noise. It is a
 * ceiling on abuse, not a traffic shaper.
 */
const WEBHOOK_MAX_PER_WINDOW = 120;

const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

/**
 * Throttles OTP requests per phone number.
 *
 * The cooldown is now set by the handler AFTER a successful send (see
 * `startOtpCooldown`); setting it here meant a failed SMS still locked the
 * caller out for a minute.
 */
export const otpRateLimiter = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const raw = (req.body as { phoneNumber?: unknown })?.phoneNumber;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new AppError('Phone number is required.', 400);
    }
    const phone = normalisePhone(raw);

    if (await cacheStore.get(`ratelimit:otp:cooldown:${phone}`)) {
      throw new AppError(
        `Please wait ${OTP_COOLDOWN_SECONDS} seconds before requesting another code.`,
        429
      );
    }

    const attempts = await cacheStore.incr(`ratelimit:otp:attempts:${phone}`, OTP_WINDOW_SECONDS);
    if (attempts > OTP_MAX_PER_WINDOW) {
      throw new AppError('Too many code requests for this number. Try again in 15 minutes.', 429);
    }

    next();
  } catch (err) {
    next(err);
  }
};

/** Called once the code has actually been delivered. */
export const startOtpCooldown = (phoneNumber: string) =>
  cacheStore.set(`ratelimit:otp:cooldown:${normalisePhone(phoneNumber)}`, '1', OTP_COOLDOWN_SECONDS);

/**
 * Caps verification attempts per IP. Complements the per-phone attempt counter
 * in authService: together they close the brute-force window on a 6-digit code.
 *
 * Disabled under test because the whole suite shares one source IP — the
 * per-phone cap in authService is the control the brute-force test exercises.
 */
export const otpVerifyRateLimiter = async (req: Request, _res: Response, next: NextFunction) => {
  if (isTest) return next();

  try {
    const count = await cacheStore.incr(
      `ratelimit:verify:${clientIp(req)}`,
      VERIFY_WINDOW_SECONDS
    );
    if (count > VERIFY_MAX_PER_WINDOW) {
      throw new AppError('Too many verification attempts. Try again later.', 429);
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Caps the payment webhook.
 *
 * That route is mounted ahead of the global limiter — it has to be, because it
 * needs the raw body before any parser touches it — which left the one endpoint
 * on the platform that is unauthenticated by design with no limit at all. Every
 * request costs an HMAC over the body and a JSON parse whether or not the
 * signature is any good, so an unbounded stream of forgeries is free work for
 * the sender and paid work for us.
 */
export const webhookRateLimiter = async (req: Request, _res: Response, next: NextFunction) => {
  if (isTest) return next();

  try {
    const count = await cacheStore.incr(
      `ratelimit:webhook:${clientIp(req)}`,
      WEBHOOK_WINDOW_SECONDS
    );
    if (count > WEBHOOK_MAX_PER_WINDOW) {
      throw new AppError('Too many webhook deliveries.', 429);
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const globalApiRateLimiter = async (req: Request, _res: Response, next: NextFunction) => {
  // Disabled under test so suites don't trip the limiter and cascade failures.
  if (isTest) return next();

  try {
    const count = await cacheStore.incr(
      `ratelimit:api:${clientIp(req)}`,
      GLOBAL_WINDOW_SECONDS
    );
    if (count > env.RATE_LIMIT_PER_MINUTE) {
      throw new AppError('API rate limit exceeded.', 429);
    }
    next();
  } catch (err) {
    next(err);
  }
};
