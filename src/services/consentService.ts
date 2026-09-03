import type { ConsentPurpose } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from './auditService.js';

/**
 * What each person has agreed to, and when.
 *
 * The platform already had transactional consent — a patient approves a
 * prescription basket before it becomes orders — but nothing recorded the
 * prior, broader agreement: permission to process personal and health data at
 * all. That is what the DPDP Act asks for, and a signed-up user with no such
 * record is a medical record held on no stated basis.
 *
 * Three properties make this worth having rather than a checkbox:
 *
 *  - **Per purpose.** Being willing to be treated is not being willing to be
 *    marketed at. Bundling them means neither is real consent.
 *  - **Versioned.** A policy that changes needs fresh agreement, and answering
 *    "who accepted the old wording" requires storing which wording they saw.
 *  - **Append-only.** Withdrawal stamps a row rather than deleting it, so the
 *    history cannot be rewritten to say somebody always agreed.
 */

/**
 * Bump when the wording changes materially.
 *
 * Everyone's consent to the changed purpose becomes stale at that moment and
 * the apps prompt again — which is the intended, slightly painful consequence,
 * and the reason not to bump it for a typo.
 */
export const POLICY_VERSIONS: Record<ConsentPurpose, string> = {
  TERMS_OF_SERVICE: '2026-08-01',
  PRIVACY_POLICY: '2026-08-01',
  TELECONSULTATION: '2026-08-01',
  MARKETING_MESSAGES: '2026-08-01',
};

/**
 * Consents without which the platform cannot lawfully operate for someone.
 *
 * These can be withdrawn — refusing to allow it would make the consent
 * meaningless — but withdrawing one is a decision to stop using the service,
 * and the caller is told so plainly rather than discovering it later.
 */
const ESSENTIAL: ConsentPurpose[] = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'];

export const isEssential = (purpose: ConsentPurpose): boolean => ESSENTIAL.includes(purpose);

export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean;
  /** True when they agreed to an older wording and need to see the new one. */
  stale: boolean;
  policyVersion: string | null;
  currentVersion: string;
  grantedAt: Date | null;
  essential: boolean;
}

/** Every purpose, with where this person stands on each. */
export const listConsentsService = async (userId: string): Promise<ConsentState[]> => {
  const live = await prisma.consentRecord.findMany({
    where: { userId, withdrawnAt: null },
    orderBy: { grantedAt: 'desc' },
  });

  return (Object.keys(POLICY_VERSIONS) as ConsentPurpose[]).map((purpose) => {
    const record = live.find((r) => r.purpose === purpose) ?? null;
    const currentVersion = POLICY_VERSIONS[purpose];

    return {
      purpose,
      granted: record !== null,
      stale: record !== null && record.policyVersion !== currentVersion,
      policyVersion: record?.policyVersion ?? null,
      currentVersion,
      grantedAt: record?.grantedAt ?? null,
      essential: isEssential(purpose),
    };
  });
};

/**
 * Is this consent in force, against the current wording?
 *
 * Used at the point of the act it authorises — a teleconsultation checks
 * TELECONSULTATION before the room opens — rather than only at sign-up, because
 * consent given two years ago to different wording is not consent now.
 */
export const hasConsent = async (userId: string, purpose: ConsentPurpose): Promise<boolean> => {
  const record = await prisma.consentRecord.findFirst({
    where: { userId, purpose, withdrawnAt: null, policyVersion: POLICY_VERSIONS[purpose] },
    select: { id: true },
  });
  return record !== null;
};

export const requireConsent = async (userId: string, purpose: ConsentPurpose): Promise<void> => {
  if (!(await hasConsent(userId, purpose))) {
    throw new AppError(
      `This requires your agreement to the ${purpose.replace(/_/g, ' ').toLowerCase()} terms.`,
      403
    );
  }
};

export interface GrantInput {
  userId: string;
  purpose: ConsentPurpose;
  /** What the client displayed. Refused if it is not the current wording. */
  policyVersion?: string;
  ipAddress?: string | null;
}

/**
 * Records agreement.
 *
 * Idempotent for an unchanged version: re-granting what is already granted
 * returns the existing record rather than stacking duplicates, because an app
 * that re-submits on every launch should not produce a thousand rows.
 */
export const grantConsentService = async (input: GrantInput) => {
  const current = POLICY_VERSIONS[input.purpose];

  /**
   * The client says which wording it showed, and it has to be the current one.
   *
   * Otherwise an app left un-updated on someone's phone goes on collecting
   * agreement to text that has since been replaced, and the record says they
   * accepted something they were never shown.
   */
  if (input.policyVersion && input.policyVersion !== current) {
    throw new AppError(
      `That is not the current version of these terms (showing ${input.policyVersion}, current is ${current}). Update the app and try again.`,
      409
    );
  }

  const existing = await prisma.consentRecord.findFirst({
    where: {
      userId: input.userId,
      purpose: input.purpose,
      withdrawnAt: null,
      policyVersion: current,
    },
  });
  if (existing) return existing;

  // Supersede any consent to older wording, so exactly one row per purpose is
  // ever live and "what is in force" has one answer.
  await prisma.consentRecord.updateMany({
    where: { userId: input.userId, purpose: input.purpose, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });

  const record = await prisma.consentRecord.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      policyVersion: current,
      ipAddress: input.ipAddress ?? null,
    },
  });

  await recordAudit({
    actorUserId: input.userId,
    action: 'consent.granted',
    entityType: 'ConsentRecord',
    entityId: record.id,
    metadata: { purpose: input.purpose, policyVersion: current },
    ipAddress: input.ipAddress ?? null,
  });

  return record;
};

export interface WithdrawResult {
  purpose: ConsentPurpose;
  withdrawnAt: Date;
  /** True when withdrawing this ends the person's ability to use the service. */
  essential: boolean;
  message: string;
}

export const withdrawConsentService = async (params: {
  userId: string;
  purpose: ConsentPurpose;
  ipAddress?: string | null;
}): Promise<WithdrawResult> => {
  const withdrawnAt = new Date();

  const result = await prisma.consentRecord.updateMany({
    where: { userId: params.userId, purpose: params.purpose, withdrawnAt: null },
    data: { withdrawnAt },
  });

  if (result.count === 0) {
    throw new AppError('You have not given that consent.', 409);
  }

  await recordAudit({
    actorUserId: params.userId,
    action: 'consent.withdrawn',
    entityType: 'User',
    entityId: params.userId,
    metadata: { purpose: params.purpose },
    ipAddress: params.ipAddress ?? null,
  });

  const essential = isEssential(params.purpose);

  return {
    purpose: params.purpose,
    withdrawnAt,
    essential,
    message: essential
      ? 'Withdrawn. The platform cannot provide care without this, so your account will not be usable until you agree again. Your existing records are unaffected — close your account if you want them erased.'
      : 'Withdrawn. This changes nothing about the care available to you.',
  };
};
