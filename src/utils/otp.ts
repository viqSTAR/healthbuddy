import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { OTP_KEY } from './secrets.js';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300; // 5 minutes
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Cryptographically secure 6-digit code. `Math.random()` is predictable from
 * observed outputs and must never generate an auth credential.
 */
export const generateOtp = (): string =>
  randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');

/**
 * OTPs are stored hashed so a Redis dump or read-only cache exposure cannot be
 * replayed into account takeover. Keyed rather than a bare digest, since a
 * 6-digit space is trivially rainbow-tabled otherwise — and keyed with a
 * purpose-derived key rather than the token secret itself, so an OTP hash and a
 * signed token can never be confused for one another. See utils/secrets.
 */
export const hashOtp = (otp: string, phoneNumber: string): string =>
  createHmac('sha256', OTP_KEY).update(`${phoneNumber}:${otp}`).digest('hex');

/** Constant-time compare so response latency cannot leak a correct prefix. */
export const otpMatches = (candidate: string, phoneNumber: string, storedHash: string): boolean => {
  const candidateHash = Buffer.from(hashOtp(candidate, phoneNumber), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (candidateHash.length !== expected.length) return false;
  return timingSafeEqual(candidateHash, expected);
};

/** E.164-ish normalisation: strip everything but digits and a leading `+`. */
export const normalisePhone = (raw: string): string => {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
};
