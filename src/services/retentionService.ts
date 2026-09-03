import { prisma } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { recordAudit } from './auditService.js';

/**
 * Enforcing the retention periods, rather than merely documenting them.
 *
 * DATA-POLICY.md states how long each category is kept. Until this existed that
 * was an intention: nothing deleted a two-year-old push notification, so the
 * real retention period for everything was "forever", and a policy that the
 * system does not implement is worse than no policy — it is a claim that would
 * not survive being checked.
 *
 * The division here is the important part.
 *
 * **Swept automatically** is data with a short period and no external
 * obligation attached: notification copies, dead device registrations,
 * long-processed webhook receipts. Deleting these is reversible in the only
 * sense that matters — nobody is worse off, because the information they carry
 * is held properly elsewhere.
 *
 * **Reported, never deleted** is everything with a statutory floor: medical
 * records, payments, the audit log. Their period expiring means deletion is now
 * *permitted*, not that it should happen unattended. A job that quietly erases
 * medical records on a timer is one misconfigured constant away from a
 * catastrophe nobody can undo, and the correct output is a number on a screen
 * for someone to act on.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/** Mirrors the table in DATA-POLICY.md §2. Change both together. */
export const RETENTION_DAYS = {
  /** A copy of information held properly elsewhere. */
  notifications: 90,
  /** A registration nothing has used in this long is a reinstalled phone. */
  staleDeviceTokens: 180,
  /** Kept long enough to reconcile a disputed settlement, then noise. */
  processedWebhookEvents: 365,
  /** Which tips someone has already been sent, so they are not re-sent. */
  healthTipDeliveries: 365,
} as const;

/** Statutory floors. Past these, deletion becomes permitted — never automatic. */
export const REVIEW_AFTER_DAYS = {
  clinicalRecords: 3 * 365,
  financialRecords: 8 * 365,
  auditLog: 8 * 365,
} as const;

export interface SweepResult {
  notifications: number;
  staleDeviceTokens: number;
  processedWebhookEvents: number;
  healthTipDeliveries: number;
}

export interface ReviewResult {
  /** Consultations past the clinical floor, eligible for review. */
  consultations: number;
  prescriptions: number;
  labOrders: number;
  payments: number;
  auditEntries: number;
}

export interface RetentionReport {
  ranAt: string;
  dryRun: boolean;
  swept: SweepResult;
  awaitingReview: ReviewResult;
  note: string;
}

/**
 * What is eligible for deletion under a statutory floor.
 *
 * Counted, not touched. Someone has to decide, and they cannot decide without
 * knowing the number.
 */
const countAwaitingReview = async (): Promise<ReviewResult> => {
  const clinicalBefore = daysAgo(REVIEW_AFTER_DAYS.clinicalRecords);
  const financialBefore = daysAgo(REVIEW_AFTER_DAYS.financialRecords);
  const auditBefore = daysAgo(REVIEW_AFTER_DAYS.auditLog);

  const [consultations, prescriptions, labOrders, payments, auditEntries] = await Promise.all([
    prisma.appointment.count({ where: { createdAt: { lt: clinicalBefore } } }),
    prisma.prescription.count({ where: { createdAt: { lt: clinicalBefore } } }),
    prisma.labOrder.count({ where: { createdAt: { lt: clinicalBefore } } }),
    prisma.payment.count({ where: { createdAt: { lt: financialBefore } } }),
    prisma.auditLog.count({ where: { createdAt: { lt: auditBefore } } }),
  ]);

  return { consultations, prescriptions, labOrders, payments, auditEntries };
};

/** Counts what a sweep would remove, without removing it. */
const previewSweep = async (): Promise<SweepResult> => {
  const [notifications, staleDeviceTokens, processedWebhookEvents, healthTipDeliveries] =
    await Promise.all([
      prisma.notification.count({
        where: { createdAt: { lt: daysAgo(RETENTION_DAYS.notifications) } },
      }),
      prisma.deviceToken.count({
        where: { lastSeenAt: { lt: daysAgo(RETENTION_DAYS.staleDeviceTokens) } },
      }),
      prisma.paymentWebhookEvent.count({
        where: {
          processedAt: { not: null, lt: daysAgo(RETENTION_DAYS.processedWebhookEvents) },
        },
      }),
      prisma.healthTipDelivery.count({
        where: { createdAt: { lt: daysAgo(RETENTION_DAYS.healthTipDeliveries) } },
      }),
    ]);

  return { notifications, staleDeviceTokens, processedWebhookEvents, healthTipDeliveries };
};

/**
 * Runs the sweep.
 *
 * `dryRun` defaults to true. A destructive job that does its work when invoked
 * with no arguments is one stray call away from a bad afternoon, and the
 * overwhelmingly common reason to run this by hand is to see what it would do.
 */
export const enforceRetentionService = async (
  options: { dryRun?: boolean; actorUserId?: string | null } = {}
): Promise<RetentionReport> => {
  const dryRun = options.dryRun ?? true;

  const awaitingReview = await countAwaitingReview();

  if (dryRun) {
    return {
      ranAt: new Date().toISOString(),
      dryRun: true,
      swept: await previewSweep(),
      awaitingReview,
      note: 'Nothing was deleted. Run with dryRun=false to apply.',
    };
  }

  /**
   * Sequential rather than concurrent, and each on its own.
   *
   * These are unrelated deletes against different tables, so a transaction buys
   * nothing except a long lock; and if one fails the others having succeeded is
   * fine — the next run picks up whatever is left. Batching them into one
   * `$transaction` would mean a single unlucky table blocks the whole sweep
   * every night.
   */
  const notifications = await prisma.notification.deleteMany({
    where: { createdAt: { lt: daysAgo(RETENTION_DAYS.notifications) } },
  });

  const staleDeviceTokens = await prisma.deviceToken.deleteMany({
    where: { lastSeenAt: { lt: daysAgo(RETENTION_DAYS.staleDeviceTokens) } },
  });

  const processedWebhookEvents = await prisma.paymentWebhookEvent.deleteMany({
    // Only ones that were actually processed. An unprocessed webhook is money
    // that moved at the gateway and did not move here — that is a bug to
    // investigate, not a row to age out.
    where: { processedAt: { not: null, lt: daysAgo(RETENTION_DAYS.processedWebhookEvents) } },
  });

  const healthTipDeliveries = await prisma.healthTipDelivery.deleteMany({
    where: { createdAt: { lt: daysAgo(RETENTION_DAYS.healthTipDeliveries) } },
  });

  const swept: SweepResult = {
    notifications: notifications.count,
    staleDeviceTokens: staleDeviceTokens.count,
    processedWebhookEvents: processedWebhookEvents.count,
    healthTipDeliveries: healthTipDeliveries.count,
  };

  const total = Object.values(swept).reduce((a, b) => a + b, 0);

  await recordAudit({
    actorUserId: options.actorUserId ?? null,
    action: 'retention.swept',
    entityType: 'System',
    entityId: 'retention',
    // Spread into plain objects: Prisma's JSON input type wants an index
    // signature, which a named interface does not carry.
    metadata: { swept: { ...swept }, awaitingReview: { ...awaitingReview } },
  });

  logger.info(`[retention] removed ${total} expired row(s): ${JSON.stringify(swept)}`);

  return {
    ranAt: new Date().toISOString(),
    dryRun: false,
    swept,
    awaitingReview,
    note:
      'Records under a statutory floor are counted, never deleted automatically — ' +
      'see DATA-POLICY.md §2.',
  };
};
