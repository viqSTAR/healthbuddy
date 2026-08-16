import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, notFound } from '../utils/AppError.js';
import { notify } from './notificationService.js';

/**
 * Follow-up messaging between a patient and a doctor who has actually seen them.
 *
 * The rules this file enforces are the ones that make an always-on channel to a
 * doctor safe to offer at all:
 *
 *  - it opens only after a completed consultation, so it is follow-up care
 *    rather than a consultation conducted without one;
 *  - it expires, because an open channel forever after one paid consult is
 *    unlimited unpaid care and doctors simply stop reading it;
 *  - the doctor may close or extend it, because they carry the clinical
 *    responsibility for what is said here;
 *  - an admin may block it, for harassment or for a doctor pulling payment
 *    off-platform — but admin is the override, not the operator, because a
 *    non-clinician should not be arbitrating clinical availability.
 */

/** Why a thread will not accept a message. Null when it will. */
export type ChatBlockReason =
  | 'EXPIRED'
  | 'CLOSED_BY_DOCTOR'
  | 'BLOCKED_BY_ADMIN'
  | null;

const threadView = {
  id: true,
  patientId: true,
  doctorId: true,
  openedAt: true,
  expiresAt: true,
  closedAt: true,
  blockedAt: true,
  blockedReason: true,
} as const;

const blockReasonFor = (thread: {
  expiresAt: Date;
  closedAt: Date | null;
  blockedAt: Date | null;
}): ChatBlockReason => {
  // Admin block wins: it must survive a doctor reopening the thread.
  if (thread.blockedAt) return 'BLOCKED_BY_ADMIN';
  if (thread.closedAt) return 'CLOSED_BY_DOCTOR';
  if (thread.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
  return null;
};

const MESSAGE_FOR: Record<Exclude<ChatBlockReason, null>, string> = {
  EXPIRED: 'This conversation has ended. Book a follow-up to speak to the doctor again.',
  CLOSED_BY_DOCTOR: 'The doctor has closed this conversation. Book a follow-up to continue.',
  BLOCKED_BY_ADMIN: 'This conversation is unavailable. Contact support.',
};

const windowEnd = (from: Date) =>
  new Date(from.getTime() + env.CHAT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

/**
 * Opens or extends the channel for a completed consultation.
 *
 * Called when a consultation ends rather than when a patient first taps chat:
 * the entitlement is earned by the consultation, so it should exist the moment
 * the consultation does, not the moment someone goes looking for it.
 *
 * A second consultation extends the same thread rather than starting a parallel
 * one — two threads with the same doctor is a history split across two places
 * nobody would think to check.
 */
export const openChatForAppointmentService = async (appointmentId: string) => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, patientId: true, doctorId: true, status: true },
  });
  if (!appointment) throw notFound('Appointment');
  if (appointment.status !== 'COMPLETED') return null;

  const expiresAt = windowEnd(new Date());

  return prisma.chatThread.upsert({
    where: {
      patientId_doctorId: { patientId: appointment.patientId, doctorId: appointment.doctorId },
    },
    // A fresh consultation reopens a thread the doctor had closed and clears an
    // expiry — but never an admin block, which is deliberately not touched here.
    update: { expiresAt, closedAt: null, openedByAppointmentId: appointment.id },
    create: {
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      openedByAppointmentId: appointment.id,
      expiresAt,
    },
    select: threadView,
  });
};

const decorate = <T extends { expiresAt: Date; closedAt: Date | null; blockedAt: Date | null }>(
  thread: T
) => {
  const blocked = blockReasonFor(thread);
  return {
    ...thread,
    canSend: blocked === null,
    blockedBecause: blocked,
    /** Ready to show. The client should not be reassembling this sentence. */
    blockedMessage: blocked ? MESSAGE_FOR[blocked] : null,
  };
};

/** Every thread this user is a party to, most recently active first. */
export const listThreadsService = async (
  readerUserId: string,
  party: { patientId?: string; doctorId?: string }
) => {
  if (!party.patientId && !party.doctorId) return [];

  const threads = await prisma.chatThread.findMany({
    where: {
      ...(party.patientId ? { patientId: party.patientId } : {}),
      ...(party.doctorId ? { doctorId: party.doctorId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      ...threadView,
      doctor: { select: { id: true, name: true, specialty: true } },
      patient: { select: { id: true, fullName: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, createdAt: true, senderUserId: true },
      },
      _count: { select: { messages: true } },
    },
  });

  /**
   * Unread counts in one grouped query rather than one per thread.
   *
   * A doctor with a day's worth of conversations would otherwise pay a query
   * per row just to render a badge.
   */
  const unreadByThread = new Map<string, number>();
  if (threads.length > 0) {
    const grouped = await prisma.chatMessage.groupBy({
      by: ['threadId'],
      where: {
        threadId: { in: threads.map((t) => t.id) },
        senderUserId: { not: readerUserId },
        readAt: null,
      },
      _count: { _all: true },
    });
    for (const row of grouped) unreadByThread.set(row.threadId, row._count._all);
  }

  return threads.map(({ messages, _count, ...thread }) => ({
    ...decorate(thread),
    lastMessage: messages[0] ?? null,
    messageCount: _count.messages,
    unreadCount: unreadByThread.get(thread.id) ?? 0,
  }));
};

const requireParty = async (threadId: string, party: { patientId?: string; doctorId?: string }) => {
  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    select: {
      ...threadView,
      // Names as well as ids: a client opening this thread from a notification
      // has nothing but the id, and a conversation headed "Your doctor" when
      // the server knows the name is a worse screen for no reason.
      patient: { select: { userId: true, id: true, fullName: true } },
      doctor: { select: { userId: true, id: true, name: true, specialty: true } },
    },
  });
  if (!thread) throw notFound('Conversation');

  const isPatient = party.patientId && thread.patientId === party.patientId;
  const isDoctor = party.doctorId && thread.doctorId === party.doctorId;
  // 404 rather than 403: thread ids must not be probeable.
  if (!isPatient && !isDoctor) throw notFound('Conversation');

  return thread;
};

export const getThreadService = async (
  threadId: string,
  party: { patientId?: string; doctorId?: string }
) => {
  const thread = await requireParty(threadId, party);

  const messages = await prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, senderUserId: true, body: true, readAt: true, createdAt: true },
  });

  // `userId` identifies the parties to the server; it is not the client's business.
  const { patient, doctor, ...rest } = thread;
  return {
    ...decorate(rest),
    patient: { id: patient.id, fullName: patient.fullName },
    doctor: { id: doctor.id, name: doctor.name, specialty: doctor.specialty },
    messages,
  };
};

export const sendMessageService = async (
  threadId: string,
  senderUserId: string,
  party: { patientId?: string; doctorId?: string },
  body: string
) => {
  const thread = await requireParty(threadId, party);

  const blocked = blockReasonFor(thread);
  if (blocked) throw new AppError(MESSAGE_FOR[blocked], 403);

  const message = await prisma.chatMessage.create({
    data: { threadId, senderUserId, body: body.trim() },
    select: { id: true, senderUserId: true, body: true, readAt: true, createdAt: true },
  });

  // Touch the thread so the list orders by real activity.
  await prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });

  // Notify the other party — whoever did not send it.
  const recipientUserId =
    senderUserId === thread.patient.userId ? thread.doctor.userId : thread.patient.userId;

  await notify({
    userId: recipientUserId,
    type: 'GENERIC',
    title: 'New message',
    body: body.trim().slice(0, 120),
    data: { threadId },
    appId: senderUserId === thread.patient.userId ? 'DOCTOR' : 'PATIENT',
  });

  return message;
};

export const markThreadReadService = async (
  threadId: string,
  readerUserId: string,
  party: { patientId?: string; doctorId?: string }
) => {
  await requireParty(threadId, party);

  const { count } = await prisma.chatMessage.updateMany({
    // Only the other side's messages: marking your own as read is meaningless.
    where: { threadId, senderUserId: { not: readerUserId }, readAt: null },
    data: { readAt: new Date() },
  });

  return { marked: count };
};

/* ---------- Doctor controls ---------- */

/**
 * The doctor closes or extends. Not the patient: the entitlement is the
 * doctor's to grant, and a patient who could extend it indefinitely would have
 * the unlimited channel this design exists to avoid.
 */
export const setThreadOpenService = async (
  threadId: string,
  doctorId: string,
  open: boolean
) => {
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, doctorId },
    select: { id: true, blockedAt: true },
  });
  if (!thread) throw notFound('Conversation');

  if (thread.blockedAt) {
    throw new AppError('This conversation has been blocked by an administrator.', 403);
  }

  return prisma.chatThread.update({
    where: { id: threadId },
    data: open
      ? { closedAt: null, expiresAt: windowEnd(new Date()) }
      : { closedAt: new Date() },
    select: threadView,
  });
};

/* ---------- Admin override ---------- */

export const setThreadBlockedService = async (
  threadId: string,
  blocked: boolean,
  reason?: string
) => {
  const thread = await prisma.chatThread.findUnique({ where: { id: threadId }, select: { id: true } });
  if (!thread) throw notFound('Conversation');

  return prisma.chatThread.update({
    where: { id: threadId },
    data: blocked
      ? { blockedAt: new Date(), blockedReason: reason ?? null }
      : { blockedAt: null, blockedReason: null },
    select: threadView,
  });
};
