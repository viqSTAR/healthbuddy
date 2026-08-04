import type { HealthTip, Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { notify } from './notificationService.js';
import { logger } from '../utils/logger.js';

/**
 * Condition-aware health content.
 *
 * The rule: a tip is matched against the patient's own record, never
 * broadcast. Someone with no diabetes diagnosis should not be told how to
 * manage their blood sugar — health content that ignores the reader is spam,
 * and people mute the channel that carries it. Once muted, the notifications
 * that actually matter (a report is ready, a rider is outside) go unread too.
 *
 * So: match on chronic conditions, allergies, recent diagnoses and age; send
 * each tip at most once per patient; cap the rate.
 */

/** How many tips a patient may receive in one sweep. */
const MAX_TIPS_PER_RUN = 2;

/** Diagnoses older than this stop being a reason to send advice. */
const DIAGNOSIS_LOOKBACK_DAYS = 90;

const terms = (value: string | null | undefined): string[] =>
  (value ?? '')
    .toLowerCase()
    .split(/[,;/]|\band\b/)
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * Everything known about a patient that a tip can be matched against.
 * Read once per patient rather than per tip.
 */
const buildProfile = async (patientId: string) => {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, userId: true, age: true, chronicConditions: true, allergies: true },
  });
  if (!patient) return null;

  const since = new Date(Date.now() - DIAGNOSIS_LOOKBACK_DAYS * 86_400_000);
  const recent = await prisma.prescription.findMany({
    where: { patientId, createdAt: { gte: since } },
    select: { diagnosis: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return {
    patient,
    conditions: terms(patient.chronicConditions),
    allergies: terms(patient.allergies),
    diagnoses: recent.flatMap((r) => terms(r.diagnosis)),
  };
};

type Profile = NonNullable<Awaited<ReturnType<typeof buildProfile>>>;

/** Substring match both ways, so "type 2 diabetes" matches a "diabetes" tip. */
const hits = (haystack: string[], needles: string[]): boolean =>
  needles.some((n) => haystack.some((h) => h.includes(n) || n.includes(h)));

const isRelevant = (tip: HealthTip, profile: Profile): boolean => {
  const age = profile.patient.age;
  if (tip.minAge !== null && (age === null || age < tip.minAge)) return false;
  if (tip.maxAge !== null && (age === null || age > tip.maxAge)) return false;

  const values = tip.matchValues.map((v) => v.toLowerCase());

  switch (tip.audience) {
    case 'EVERYONE':
      return true;
    case 'CONDITION':
      return hits(profile.conditions, values);
    case 'ALLERGY':
      return hits(profile.allergies, values);
    case 'DIAGNOSIS':
      return hits(profile.diagnoses, values);
    case 'AGE_RANGE':
      // The age bounds above already decided this.
      return true;
    default:
      return false;
  }
};

/**
 * Picks and delivers tips for one patient.
 *
 * `HealthTipDelivery` has a unique constraint on (tip, patient), so a repeated
 * run cannot send the same advice twice even if it races with itself.
 */
export const deliverTipsForPatientService = async (patientId: string) => {
  const profile = await buildProfile(patientId);
  if (!profile) return { delivered: 0 };

  const [candidates, alreadySent] = await Promise.all([
    prisma.healthTip.findMany({ where: { isActive: true }, orderBy: { priority: 'desc' } }),
    prisma.healthTipDelivery.findMany({ where: { patientId }, select: { healthTipId: true } }),
  ]);

  const seen = new Set(alreadySent.map((d) => d.healthTipId));
  const relevant = candidates
    .filter((tip) => !seen.has(tip.id) && isRelevant(tip, profile))
    .slice(0, MAX_TIPS_PER_RUN);

  let delivered = 0;
  for (const tip of relevant) {
    try {
      // The unique constraint is the real guard against a duplicate send.
      await prisma.healthTipDelivery.create({ data: { healthTipId: tip.id, patientId } });
    } catch {
      continue;
    }

    await notify({
      userId: profile.patient.userId,
      type: 'GENERIC',
      title: tip.title,
      body: tip.body,
      data: { healthTipId: tip.id, category: tip.category },
      appId: 'PATIENT',
    });
    delivered += 1;
  }

  return { delivered };
};

/** Sweeps every patient. Intended for a daily scheduled job. */
export const deliverTipsToAllPatientsService = async () => {
  const patients = await prisma.patient.findMany({ select: { id: true } });

  let total = 0;
  for (const patient of patients) {
    try {
      const { delivered } = await deliverTipsForPatientService(patient.id);
      total += delivered;
    } catch (err) {
      logger.warn(`[health-tips] failed for patient ${patient.id}: ${(err as Error).message}`);
    }
  }

  logger.info(`[health-tips] delivered ${total} tip(s) across ${patients.length} patient(s)`);
  return { patients: patients.length, delivered: total };
};

/** The tips this patient has already been sent, for an in-app library. */
export const listMyTipsService = async (patientId: string) => {
  const rows = await prisma.healthTipDelivery.findMany({
    where: { patientId },
    include: { healthTip: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rows.map((row) => ({
    id: row.healthTip.id,
    title: row.healthTip.title,
    body: row.healthTip.body,
    category: row.healthTip.category,
    receivedAt: row.createdAt,
  }));
};

/* ---------- Admin authoring ---------- */

export const listHealthTipsService = async (page: number, limit: number) => {
  const [total, tips] = await Promise.all([
    prisma.healthTip.count(),
    prisma.healthTip.findMany({
      orderBy: [{ isActive: 'desc' }, { priority: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { _count: { select: { deliveries: true } } },
    }),
  ]);
  return { total, page, limit, tips };
};

export const upsertHealthTipService = (data: Prisma.HealthTipUncheckedCreateInput & { id?: string }) => {
  const { id, ...rest } = data;
  return id
    ? prisma.healthTip.update({ where: { id }, data: rest })
    : prisma.healthTip.create({ data: rest });
};
