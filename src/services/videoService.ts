import { randomBytes } from 'node:crypto';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, notFound } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { recordAudit } from './auditService.js';

/**
 * Video consultation transport.
 *
 * The security property that matters here: **a room name is a bearer
 * credential.** On every hosted video service, anyone who can reach the room
 * identifier can walk into the consultation. So the identifier is 128 bits of
 * randomness rather than the appointment id, it is only ever handed to the two
 * people on the appointment, and it is only handed over inside a time window
 * around the booked slot.
 *
 * Providers:
 *   mock   — no transport; the app renders the call shell. Zero setup.
 *   jitsi  — a room URL on a Jitsi deployment. Free.
 *   daily  — a *private* room plus a per-participant meeting token, so the URL
 *            alone is not enough to join. Free tier is 10,000 participant
 *            minutes a month.
 *
 * All three open in a normal browser, which is what makes them testable in Expo
 * Go today: a native WebRTC SDK needs a development build.
 */

export type VideoRole = 'PATIENT' | 'DOCTOR';

export interface VideoSession {
  provider: string;
  roomId: string;
  /** What the client opens. Null under `mock`. */
  url: string | null;
  displayName: string;
  role: VideoRole;
  /** When the join grant lapses. */
  expiresAt: Date;
  /** Shown in the lobby when there is no real transport configured. */
  notice?: string;
}

interface RoomRequest {
  roomId: string;
  displayName: string;
  role: VideoRole;
  expiresAt: Date;
}

interface VideoProvider {
  readonly name: string;
  join(req: RoomRequest): Promise<{ url: string | null; notice?: string }>;
}

const mockVideoProvider: VideoProvider = {
  name: 'mock',
  async join() {
    return {
      url: null,
      notice:
        'Video transport is not configured, so this is a preview of the call screen. Set VIDEO_PROVIDER to enable real calls.',
    };
  },
};

const jitsiProvider: VideoProvider = {
  name: 'jitsi',
  async join(req) {
    const params = new URLSearchParams();
    params.set('userInfo.displayName', `"${req.displayName}"`);
    // A waiting room means a patient who joins early is not left alone in an
    // open room, and the doctor sees who is asking to enter.
    params.set('config.prejoinPageEnabled', 'true');
    params.set('config.disableDeepLinking', 'true');

    return { url: `https://${env.JITSI_DOMAIN}/${req.roomId}#${params.toString()}` };
  },
};

/**
 * Daily rooms are created `private`, so the URL is useless on its own — a
 * short-lived meeting token scoped to this room and this person is what gets
 * you in. That is the difference between a link that leaks and a link that
 * expires.
 */
const dailyProvider: VideoProvider = {
  name: 'daily',
  async join(req) {
    const apiKey = env.DAILY_API_KEY!;
    const expSeconds = Math.floor(req.expiresAt.getTime() / 1000);

    const call = async <T>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(`https://api.daily.co/v1${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (!res.ok) throw new AppError(`Video provider error: ${text.slice(0, 200)}`, 502);
      return JSON.parse(text) as T;
    };

    // Creating the room is idempotent in effect: the second participant hits
    // "already exists" and simply proceeds to token minting.
    let roomUrl: string;
    try {
      const room = await call<{ url: string }>('/rooms', {
        name: req.roomId,
        privacy: 'private',
        properties: {
          exp: expSeconds,
          eject_at_room_exp: true,
          enable_prejoin_ui: true,
          enable_chat: true,
          start_video_off: false,
        },
      });
      roomUrl = room.url;
    } catch (err) {
      if (!/already exists/i.test((err as Error).message)) throw err;
      roomUrl = `https://${env.DAILY_SUBDOMAIN ?? 'api'}.daily.co/${req.roomId}`;
    }

    const token = await call<{ token: string }>('/meeting-tokens', {
      properties: {
        room_name: req.roomId,
        user_name: req.displayName,
        // The doctor runs the consultation.
        is_owner: req.role === 'DOCTOR',
        exp: expSeconds,
      },
    });

    return { url: `${roomUrl}?t=${token.token}` };
  },
};

const providers: Record<string, VideoProvider> = {
  mock: mockVideoProvider,
  jitsi: jitsiProvider,
  daily: dailyProvider,
};

const activeProvider = (): VideoProvider => providers[env.VIDEO_PROVIDER] ?? mockVideoProvider;

/**
 * The booked instant, from the slot's `YYYY-MM-DD` and `HH:mm` strings.
 *
 * These carry no zone, so they are read in the server's local time — set TZ on
 * the deployment (Asia/Kolkata for an India launch) or a consultation booked
 * for 10:00 opens at the wrong hour.
 */
const slotStartsAt = (date: string, startTime: string): Date | null => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = startTime.split(':').map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return null;
  return new Date(y!, m! - 1, d!, hh!, mm!, 0, 0);
};

export interface JoinInput {
  appointmentId: string;
  userId: string;
  ipAddress?: string | null;
}

/**
 * Issues a join grant for a consultation.
 *
 * 404 for anyone who is not on this appointment — a 403 would confirm that the
 * appointment exists, which is itself a disclosure about a stranger's care.
 */
export const joinConsultationService = async (input: JoinInput): Promise<VideoSession> => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: {
      slot: { select: { date: true, startTime: true } },
      patient: { select: { userId: true, fullName: true } },
      doctor: { select: { userId: true, name: true } },
    },
  });

  if (!appointment) throw notFound('Appointment');

  const isPatient = appointment.patient.userId === input.userId;
  const isDoctor = appointment.doctor.userId === input.userId;
  if (!isPatient && !isDoctor) throw notFound('Appointment');

  if (appointment.type !== 'VIDEO') {
    throw new AppError('This appointment is an in-person visit, not a video consultation.', 400);
  }
  if (appointment.status === 'CANCELLED') {
    throw new AppError('This appointment was cancelled.', 409);
  }
  if (appointment.status === 'COMPLETED') {
    throw new AppError('This consultation has already ended.', 409);
  }

  const startsAt = slotStartsAt(appointment.slot.date, appointment.slot.startTime);
  const opensAt = startsAt
    ? new Date(startsAt.getTime() - env.VIDEO_JOIN_LEAD_MINUTES * 60_000)
    : null;
  const closesAt = startsAt
    ? new Date(startsAt.getTime() + env.VIDEO_JOIN_GRACE_MINUTES * 60_000)
    : null;
  const now = new Date();

  // An in-progress consultation stays joinable past the window — a call that
  // overruns must not eject the two people having it.
  if (appointment.status !== 'IN_PROGRESS' && opensAt && closesAt) {
    if (now < opensAt) {
      throw new AppError(
        `This consultation opens at ${appointment.slot.startTime} on ${appointment.slot.date}. You can join from ${env.VIDEO_JOIN_LEAD_MINUTES} minutes before.`,
        425
      );
    }
    if (now > closesAt) {
      throw new AppError('The window for this consultation has passed.', 410);
    }
  }

  // 128 bits, minted once and reused so both participants land in one room.
  let roomId = appointment.meetingRoomId;
  const provider = activeProvider();

  if (!roomId || appointment.meetingProvider !== provider.name) {
    roomId = `hb-${randomBytes(16).toString('hex')}`;
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { meetingRoomId: roomId, meetingProvider: provider.name },
    });
  }

  const expiresAt = closesAt && closesAt > now ? closesAt : new Date(now.getTime() + 3600_000);

  const displayName = isDoctor
    ? `Dr. ${appointment.doctor.name}`.replace(/^Dr\. Dr\.?\s*/i, 'Dr. ')
    : appointment.patient.fullName || 'Patient';

  const { url, notice } = await provider.join({
    roomId,
    displayName,
    role: isDoctor ? 'DOCTOR' : 'PATIENT',
    expiresAt,
  });

  // The doctor arriving is what starts the consultation.
  if (isDoctor && appointment.status === 'SCHEDULED') {
    await prisma.appointment
      .updateMany({
        where: { id: appointment.id, status: 'SCHEDULED' },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      })
      .catch((err: unknown) => logger.warn(`[video] could not start ${appointment.id}: ${err}`));
  }

  await recordAudit({
    actorUserId: input.userId,
    action: 'consultation.joined',
    entityType: 'Appointment',
    entityId: appointment.id,
    metadata: { role: isDoctor ? 'DOCTOR' : 'PATIENT', provider: provider.name },
    ipAddress: input.ipAddress ?? null,
  });

  return {
    provider: provider.name,
    roomId,
    url,
    displayName,
    role: isDoctor ? 'DOCTOR' : 'PATIENT',
    expiresAt,
    ...(notice ? { notice } : {}),
  };
};

/** Ends the consultation. Only the treating doctor may close it. */
export const endConsultationService = async (appointmentId: string, userId: string) => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { select: { userId: true } } },
  });

  if (!appointment) throw notFound('Appointment');
  if (appointment.doctor.userId !== userId) throw notFound('Appointment');

  const ended = await prisma.appointment.updateMany({
    where: { id: appointmentId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
    data: { status: 'COMPLETED', endedAt: new Date() },
  });

  if (ended.count === 0) {
    throw new AppError('This consultation is not in progress.', 409);
  }

  await recordAudit({
    actorUserId: userId,
    action: 'consultation.ended',
    entityType: 'Appointment',
    entityId: appointmentId,
  });

  /**
   * Ending the consultation is what earns the follow-up channel, so it opens
   * here rather than when the patient first goes looking for it.
   *
   * Imported lazily to keep the video and chat services from importing each
   * other at module load. Failure is logged, not thrown: the consultation has
   * genuinely ended, and losing the chat window must not make it look otherwise
   * to the doctor who just closed it.
   */
  try {
    const { openChatForAppointmentService } = await import('./chatService.js');
    await openChatForAppointmentService(appointmentId);
  } catch (err) {
    logger.error(`[chat] could not open a thread for appointment ${appointmentId}`, err);
  }

  return { appointmentId, status: 'COMPLETED' as const };
};
