import { randomUUID } from 'node:crypto';
import type { DocumentKind } from '@prisma/client';
import { prisma } from '../config/db.js';
import { storage } from '../utils/storage.js';
import { AppError, notFound } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { recordAudit } from './auditService.js';
import { revokeSessions } from './sessionService.js';

/**
 * Closing an account, when the records behind it cannot be thrown away.
 *
 * Two obligations point in opposite directions here and both are real.
 *
 * A person can ask for their personal data to be erased — the DPDP Act calls it
 * the right to erasure, and it is not satisfied by hiding a row. At the same
 * time a prescription, a consultation and a dispensing record are *medical*
 * records with their own retention rules, and a doctor who prescribed a drug
 * cannot have that fact deleted on request by the person who took it. The
 * money is the same: a settled payment is an accounting record, and a partner's
 * statement has to still add up next year.
 *
 * So `DELETE` was never the answer, and it was not even available: `Patient`
 * cascades from `User`, but `Appointment` and `Prescription` hold `RESTRICT`
 * references to the patient, so deleting an account with any history at all
 * failed at the database with a constraint error and nothing to tell the person
 * who asked.
 *
 * What happens instead: the identity is emptied and the record is kept. Name,
 * contact details, saved addresses, devices and the free-text health profile
 * are destroyed. The clinical and financial rows stay, now attached to a
 * subject with no personal data in it — a case number rather than a person. The
 * phone number is released, so the same number can start a genuinely new
 * account later rather than resurrecting this one.
 *
 * It is one-way. There is no un-erase, which is the point.
 */

/**
 * Documents that belong to the *person* rather than to the clinical record.
 *
 * A profile photo and an ID scan are personal data held for convenience and
 * verification; a lab report is a medical result. The first set is destroyed
 * with the identity, the second is retained with the record it belongs to.
 */
const PERSONAL_DOCUMENT_KINDS: DocumentKind[] = ['PROFILE_PHOTO', 'ID_PROOF'];

/** Work that must finish before an account can be closed. */
const blockingWork = async (userId: string, patientId: string | null) => {
  const reasons: string[] = [];

  if (patientId) {
    const [appointments, orders, labOrders] = await Promise.all([
      prisma.appointment.count({
        where: { patientId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      }),
      /**
       * The order row's status is not the order's status.
       *
       * Once an order has parcels, what it is really doing is derived from them
       * — see `deriveOrderStatus` — because an order filled by two shops is only
       * as finished as its slowest one. The row is a fallback for orders that
       * never got that far, and it can lag: the legacy per-order status route
       * writes it directly without touching the shipments.
       *
       * Reading only the row therefore had a way of being wrong in the one
       * direction that matters here. An order stamped DELIVERED with a parcel
       * still out would look finished, the erasure would go ahead, and a rider
       * would be left holding a package addressed to somebody whose address had
       * just been deleted. Either source saying "in flight" blocks.
       */
      prisma.medicineOrder.count({
        where: {
          patientId,
          OR: [
            {
              status: {
                in: ['PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PROCESSING', 'DISPATCHED'],
              },
            },
            {
              shipments: {
                some: { status: { notIn: ['DELIVERED', 'CANCELLED'] } },
              },
            },
          ],
        },
      }),
      prisma.labOrder.count({
        where: {
          patientId,
          status: { in: ['PENDING_PAYMENT', 'BOOKED', 'ACCEPTED', 'SAMPLE_COLLECTED', 'PROCESSING'] },
        },
      }),
    ]);

    if (appointments) reasons.push(`${appointments} upcoming consultation(s)`);
    if (orders) reasons.push(`${orders} order(s) still in progress`);
    if (labOrders) reasons.push(`${labOrders} lab booking(s) still in progress`);
  }

  /**
   * Providers are refused outright rather than blocked on a count.
   *
   * A doctor's registration number and a pharmacy's drug licence are on
   * prescriptions and on dispensing records that other people rely on, and a
   * partner has settlement legs that have to remain attributable. Closing a
   * provider account is an offboarding process with a payout reconciliation in
   * it, not a button — so this says so plainly instead of half-doing it.
   */
  const provider = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (provider && provider.role !== 'PATIENT') {
    reasons.push(
      `this is a ${provider.role} account — provider accounts are offboarded by support, not erased`
    );
  }

  return reasons;
};

export interface EraseInput {
  /** The account being closed. */
  userId: string;
  /** Whoever asked. The account holder themselves, or an admin acting for them. */
  actorUserId: string;
  reason?: string;
  ipAddress?: string | null;
}

export interface EraseResult {
  userId: string;
  anonymisedAt: Date;
  /** What was destroyed, for the confirmation shown to the person. */
  removed: {
    profile: boolean;
    addresses: number;
    devices: number;
    notifications: number;
    documents: number;
  };
  /** What was kept, and why — so the answer is not a silent partial erasure. */
  retained: string[];
}

export const eraseAccountService = async (input: EraseInput): Promise<EraseResult> => {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, anonymisedAt: true, patient: { select: { id: true } } },
  });
  if (!user) throw notFound('Account');

  if (user.anonymisedAt) {
    throw new AppError('This account has already been closed.', 409);
  }

  const blockers = await blockingWork(user.id, user.patient?.id ?? null);
  if (blockers.length) {
    throw new AppError(
      `This account cannot be closed yet: ${blockers.join('; ')}. ` +
        'Complete or cancel these first.',
      409
    );
  }

  /**
   * The blobs go before the transaction, not inside it.
   *
   * Object storage is not transactional — a rollback cannot bring a deleted
   * file back. Deleting first means the worst case is a file removed for an
   * erasure that then failed, which is the harmless direction: the person asked
   * for it gone. The opposite ordering leaves the file behind on a commit that
   * succeeded, which is the erasure quietly not happening.
   */
  const personalDocuments = await prisma.document.findMany({
    where: { ownerUserId: user.id, kind: { in: PERSONAL_DOCUMENT_KINDS } },
    select: { id: true, storageKey: true },
  });

  for (const doc of personalDocuments) {
    await storage.remove(doc.storageKey).catch((err) => {
      logger.error(`[erasure] could not remove blob ${doc.storageKey}`, err);
    });
  }

  const anonymisedAt = new Date();

  const removed = await prisma.$transaction(async (tx) => {
    /**
     * The phone number is replaced, not blanked.
     *
     * It is the login identifier and it is unique, so it cannot simply be
     * nulled and cannot be left in place. A random placeholder both severs the
     * account from the person and releases the real number, so signing up with
     * it again produces a new account rather than reopening this one.
     */
    await tx.user.update({
      where: { id: user.id },
      data: {
        phoneNumber: `erased:${randomUUID()}`,
        anonymisedAt,
        isSuspended: true,
        isVerified: false,
        tokenVersion: { increment: 1 },
      },
    });

    let profile = false;
    if (user.patient) {
      await tx.patient.update({
        where: { id: user.patient.id },
        data: {
          fullName: 'Closed account',
          email: null,
          age: null,
          gender: null,
          bloodGroup: null,
          emergencyContact: null,
          address: null,
          latitude: null,
          longitude: null,
          // Free-text health data. Retained nowhere: this is the patient's own
          // description of themselves, not a clinician's record of a finding.
          allergies: null,
          chronicConditions: null,
        },
      });
      profile = true;
    }

    const [addresses, devices, notifications, documents] = await Promise.all([
      tx.address.deleteMany({ where: { patientId: user.patient?.id ?? '' } }),
      tx.deviceToken.deleteMany({ where: { userId: user.id } }),
      // Notification bodies quote names, addresses and order contents back at
      // the person; they are a copy of the personal data, not a record of it.
      tx.notification.deleteMany({ where: { userId: user.id } }),
      tx.document.deleteMany({
        where: { ownerUserId: user.id, kind: { in: PERSONAL_DOCUMENT_KINDS } },
      }),
    ]);

    return {
      profile,
      addresses: addresses.count,
      devices: devices.count,
      notifications: notifications.count,
      documents: documents.count,
    };
  });

  // Belt and braces: the transaction already raised the version, but the cached
  // copy has to go or the account stays usable until the TTL lapses.
  await revokeSessions(user.id).catch((err) => {
    logger.error(`[erasure] could not revoke sessions for ${user.id}`, err);
  });

  await recordAudit({
    actorUserId: input.actorUserId,
    action: 'user.erased',
    entityType: 'User',
    entityId: user.id,
    metadata: {
      selfService: input.actorUserId === user.id,
      reason: input.reason ?? null,
      removed,
    },
    ipAddress: input.ipAddress ?? null,
  });

  logger.info(`[erasure] account ${user.id} closed and anonymised`);

  return {
    userId: user.id,
    anonymisedAt,
    removed,
    retained: [
      'Consultation and prescription records, which are medical records with their own retention period.',
      'Dispensing and lab records held by the pharmacy or laboratory that fulfilled them.',
      'Payment and settlement records required for accounting and partner statements.',
      'The audit log of privileged actions, which must remain complete to be worth keeping.',
    ],
  };
};

/**
 * Everything the platform holds about the caller, in one response.
 *
 * The other half of the same right: a person cannot make a meaningful decision
 * about erasure without being able to see what there is. Assembled from the
 * same tables the erasure touches, so the two answers cannot drift apart.
 */
export const exportAccountDataService = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phoneNumber: true,
      role: true,
      createdAt: true,
      patient: {
        include: {
          addresses: true,
        },
      },
    },
  });
  if (!user) throw notFound('Account');

  const patientId = user.patient?.id;

  const [appointments, prescriptions, medicineOrders, labOrders, payments, documents, emergencies] =
    await Promise.all([
      patientId
        ? prisma.appointment.findMany({
            where: { patientId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              type: true,
              status: true,
              symptoms: true,
              createdAt: true,
              doctor: { select: { name: true, specialty: true } },
            },
          })
        : [],
      patientId
        ? prisma.prescription.findMany({
            where: { patientId },
            orderBy: { createdAt: 'desc' },
            include: {
              items: true,
              labTests: true,
              doctor: { select: { name: true, specialty: true } },
            },
          })
        : [],
      patientId
        ? prisma.medicineOrder.findMany({
            where: { patientId },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      patientId
        ? prisma.labOrder.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } })
        : [],
      prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          purpose: true,
          method: true,
          amount: true,
          status: true,
          createdAt: true,
        },
      }),
      // Metadata only: the bytes are fetched through the documents API, which
      // authorises each one. A bulk export is not a reason to bypass that.
      prisma.document.findMany({
        where: { ownerUserId: userId },
        select: { id: true, kind: true, fileName: true, mimeType: true, createdAt: true },
      }),
      patientId
        ? prisma.emergencySOS.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } })
        : [],
    ]);

  return {
    generatedAt: new Date().toISOString(),
    account: {
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
      joinedAt: user.createdAt,
    },
    profile: user.patient,
    appointments,
    prescriptions,
    medicineOrders,
    labOrders,
    payments,
    documents,
    emergencies,
  };
};
