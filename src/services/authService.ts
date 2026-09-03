import type { Role as PrismaRole } from '@prisma/client';
import { prisma } from '../config/db.js';
import { cacheStore } from '../config/redis.js';
import { env } from '../config/env.js';
import { sendSMS } from '../utils/smsService.js';
import { generateTokens, verifyRefreshToken, type JwtPayload, type Role } from '../utils/jwt.js';
import {
  generateOtp,
  hashOtp,
  otpMatches,
  normalisePhone,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
} from '../utils/otp.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { assertAccountUsable, revokeSessions } from './sessionService.js';

/** Masks all but the last 3 digits so logs never carry a full phone number. */
const maskPhone = (phone: string) => phone.replace(/.(?=.{3})/g, '•');

const otpKey = (phone: string) => `otp:${phone}`;
const otpAttemptsKey = (phone: string) => `otp:attempts:${phone}`;

export const requestOtpService = async (rawPhone: string) => {
  const phoneNumber = normalisePhone(rawPhone);
  const otp = generateOtp();

  await cacheStore.set(otpKey(phoneNumber), hashOtp(otp, phoneNumber), OTP_TTL_SECONDS);
  await cacheStore.del(otpAttemptsKey(phoneNumber));

  const delivered = await sendSMS(
    phoneNumber,
    `Your Health Buddy verification code is ${otp}. Valid for 5 minutes. Do not share it with anyone.`
  );

  if (!delivered) {
    // Don't strand the caller behind a cooldown for a code that never arrived.
    await cacheStore.del(otpKey(phoneNumber));
    throw new AppError('Could not deliver the verification code. Please try again.', 502);
  }

  return {
    phoneNumber,
    message: 'Verification code sent.',
    expiresInSeconds: OTP_TTL_SECONDS,
    // Never keyed off NODE_ENV's default — see config/env.ts.
    ...(env.EXPOSE_DEV_OTP === 'true' ? { devOtp: otp } : {}),
  };
};

/**
 * Resolves the role and profile ids from the database.
 *
 * The client does NOT get to choose its role. A caller who has never been
 * provisioned is registered as a PATIENT; elevated roles (DOCTOR, PHARMACY,
 * LAB_PARTNER, ADMIN) exist only if an administrator created them beforehand.
 */
const loadOrRegisterUser = async (phoneNumber: string) => {
  const existing = await prisma.user.findUnique({
    where: { phoneNumber },
    include: { patient: true, doctor: true, labPartner: true, pharmacy: true, agent: true },
  });

  if (existing) return existing;

  return prisma.user.create({
    data: {
      phoneNumber,
      role: 'PATIENT',
      patient: { create: { fullName: 'Health Buddy User' } },
    },
    include: { patient: true, doctor: true, labPartner: true, pharmacy: true, agent: true },
  });
};

type LoadedUser = Awaited<ReturnType<typeof loadOrRegisterUser>>;

const toTokenPayload = (user: LoadedUser): JwtPayload => ({
  userId: user.id,
  phoneNumber: user.phoneNumber,
  role: user.role as Role,
  ...(user.patient ? { patientId: user.patient.id } : {}),
  ...(user.doctor ? { doctorId: user.doctor.id } : {}),
  ...(user.labPartner ? { labPartnerId: user.labPartner.id } : {}),
  ...(user.pharmacy ? { pharmacyId: user.pharmacy.id } : {}),
  ...(user.agent ? { agentId: user.agent.id } : {}),
});

const toPublicUser = (user: LoadedUser) => ({
  id: user.id,
  phoneNumber: user.phoneNumber,
  role: user.role,
  fullName:
    user.patient?.fullName ??
    user.doctor?.name ??
    user.labPartner?.name ??
    user.pharmacy?.name ??
    user.agent?.name ??
    null,
});

export const verifyOtpService = async (rawPhone: string, otp: string) => {
  const phoneNumber = normalisePhone(rawPhone);
  const storedHash = await cacheStore.get(otpKey(phoneNumber));

  if (!storedHash) {
    throw new AppError('This code has expired or was never issued. Request a new one.', 400);
  }

  // Cap verification attempts — /send-otp was rate limited but /verify-otp was
  // not, leaving a 6-digit code brute-forceable.
  const attempts = await cacheStore.incr(otpAttemptsKey(phoneNumber), OTP_TTL_SECONDS);
  if (attempts > OTP_MAX_ATTEMPTS) {
    await cacheStore.del(otpKey(phoneNumber));
    throw new AppError('Too many incorrect attempts. Request a new code.', 429);
  }

  if (!otpMatches(otp, phoneNumber, storedHash)) {
    throw new AppError('Incorrect verification code.', 400);
  }

  await cacheStore.del(otpKey(phoneNumber));
  await cacheStore.del(otpAttemptsKey(phoneNumber));

  const user = await loadOrRegisterUser(phoneNumber);

  /**
   * A correct code is not the same as a permitted sign-in.
   *
   * This check was absent, which made the admin panel's Suspend button
   * decorative: a suspended account passed OTP verification like any other and
   * walked away with a fresh, fully privileged token pair.
   */
  assertAccountUsable(user);

  const tokens = generateTokens(toTokenPayload(user), user.tokenVersion);

  // Masked: an authentication log is one of the likeliest things to be shipped
  // off-box to an aggregator, and a phone number is the account identifier here.
  logger.info(`[auth] ${maskPhone(phoneNumber)} authenticated as ${user.role}`);
  return { user: toPublicUser(user), tokens };
};

/** Exchanges a valid refresh token for a new pair, re-reading role from the DB. */
export const refreshTokensService = async (refreshToken: string) => {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid or expired refresh token.', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    include: { patient: true, doctor: true, labPartner: true, pharmacy: true, agent: true },
  });

  if (!user) throw new AppError('Account no longer exists.', 401);

  // Suspending an account has to reach the refresh endpoint too, or a suspended
  // user simply trades their week-long refresh token for a new access token
  // every fifteen minutes and never notices.
  assertAccountUsable(user);

  /**
   * A refresh token from before the last revocation is spent. This is what
   * makes signing out mean something on a device that still holds the token,
   * and what stops a stolen refresh token outliving the moment it is reported.
   */
  if ((claims.tv ?? 0) < user.tokenVersion) {
    throw new AppError('This session has ended. Please sign in again.', 401);
  }

  // Role is re-read from the database, so a revoked or downgraded role takes
  // effect on the next refresh rather than persisting for the token's lifetime.
  return {
    user: toPublicUser(user),
    tokens: generateTokens(toTokenPayload(user), user.tokenVersion),
  };
};

/**
 * Signing out.
 *
 * Deliberately global rather than per-device: this raises `tokenVersion`, which
 * ends every session the account holds. The alternative — tracking individual
 * token ids so one device can leave while others stay — is a session table, and
 * a session table that is not also consulted on every request buys nothing. The
 * property worth having is that a person who has lost a phone can make the
 * tokens on it stop working, and that is this.
 */
export const signOutService = async (refreshToken: string | null): Promise<void> => {
  if (!refreshToken) return;

  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    // Nothing to revoke, and nothing worth telling the caller: signing out with
    // an expired token is a success from where they are standing.
    return;
  }

  await revokeSessions(claims.userId).catch((err) => {
    logger.error(`[auth] sign-out could not revoke sessions for ${claims.userId}`, err);
  });
};

/** Admin-only provisioning of elevated roles. */
export const provisionRoleService = async (
  rawPhone: string,
  role: Exclude<Role, 'PATIENT'>,
  profile: { name: string; specialty?: string; consultationFee?: number; address?: string; location?: string }
) => {
  const phoneNumber = normalisePhone(rawPhone);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { phoneNumber },
      update: { role: role as PrismaRole },
      create: { phoneNumber, role: role as PrismaRole },
    });

    switch (role) {
      case 'DOCTOR':
        await tx.doctor.upsert({
          where: { userId: user.id },
          update: { name: profile.name, specialty: profile.specialty ?? 'General Physician' },
          create: {
            userId: user.id,
            name: profile.name,
            specialty: profile.specialty ?? 'General Physician',
            consultationFee: profile.consultationFee ?? 50,
          },
        });
        break;
      case 'PHARMACY':
        await tx.pharmacy.upsert({
          where: { userId: user.id },
          update: { name: profile.name, address: profile.address ?? '' },
          create: { userId: user.id, name: profile.name, address: profile.address ?? '' },
        });
        break;
      case 'LAB_PARTNER':
        await tx.labPartner.upsert({
          where: { userId: user.id },
          update: { name: profile.name, location: profile.location ?? '' },
          create: { userId: user.id, name: profile.name, location: profile.location ?? '' },
        });
        break;
      /**
       * Provisioned by an admin is provisioned verified — the same as every
       * other provider here. An agent who signs themselves up through the app
       * is created unverified instead, and cannot take a job until someone has
       * checked them, because taking a job is what reveals a patient's address.
       */
      case 'DELIVERY_AGENT':
        await tx.deliveryAgent.upsert({
          where: { userId: user.id },
          update: { name: profile.name, verifiedAt: new Date() },
          create: { userId: user.id, name: profile.name, verifiedAt: new Date() },
        });
        break;
      case 'ADMIN':
        break;
    }

    return { id: user.id, phoneNumber: user.phoneNumber, role: user.role };
  });

  /**
   * A role change has to end the account's existing sessions.
   *
   * Profile ids and the role are baked into the token at sign-in, so a person
   * who was signed in as a PATIENT when they were promoted keeps a token that
   * says PATIENT — and, worse in the other direction, a demoted admin keeps an
   * admin token until it expires. Forcing a fresh sign-in is the only way the
   * new grant and the old one cannot overlap.
   */
  await revokeSessions(result.id);

  return result;
};
