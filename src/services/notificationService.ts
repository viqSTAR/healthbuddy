import type { AppId, NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { notFound } from '../utils/AppError.js';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  /** Restrict delivery to one app when the same person holds two identities. */
  appId?: AppId;
}

/**
 * Sends to Expo's push service. Tokens Expo reports as unregistered are pruned
 * so a reinstalled device stops accumulating dead rows.
 */
const dispatchPush = async (
  tokens: { token: string }[],
  payload: { title: string; body: string; data?: Prisma.InputJsonValue }
): Promise<void> => {
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      logger.warn(`[push] Expo responded ${res.status}`);
      return;
    }

    const parsed = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const dead = (parsed.data ?? [])
      .map((entry, i) => (entry.details?.error === 'DeviceNotRegistered' ? tokens[i]?.token : null))
      .filter((t): t is string => Boolean(t));

    if (dead.length) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
      logger.info(`[push] pruned ${dead.length} unregistered device token(s)`);
    }
  } catch (err) {
    // Push is best-effort; the in-app notification row is the source of truth.
    logger.warn(`[push] delivery failed: ${(err as Error).message}`);
  }
};

/**
 * Records an in-app notification and attempts a push. Never throws — a failed
 * notification must not roll back the action that triggered it.
 */
export const notify = async (input: NotifyInput): Promise<void> => {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        ...(input.data !== undefined ? { data: input.data } : {}),
      },
    });

    const tokens = await prisma.deviceToken.findMany({
      where: { userId: input.userId, ...(input.appId ? { appId: input.appId } : {}) },
      select: { token: true },
    });

    await dispatchPush(tokens, {
      title: input.title,
      body: input.body,
      ...(input.data !== undefined ? { data: input.data } : {}),
    });
  } catch (err) {
    logger.error(`[notify] failed for user ${input.userId}`, err);
  }
};

/** Fan-out to every admin — used for "an application is waiting for review". */
export const notifyAdmins = async (input: Omit<NotifyInput, 'userId'>): Promise<void> => {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  await Promise.all(admins.map((a) => notify({ ...input, userId: a.id })));
};

export const registerDeviceTokenService = async (params: {
  userId: string;
  token: string;
  appId: AppId;
  platform: string;
}) => {
  // A device can change hands between accounts, so the token is re-pointed at
  // whoever most recently registered it rather than duplicated.
  const row = await prisma.deviceToken.upsert({
    where: { token: params.token },
    update: {
      userId: params.userId,
      appId: params.appId,
      platform: params.platform,
      lastSeenAt: new Date(),
    },
    create: {
      userId: params.userId,
      token: params.token,
      appId: params.appId,
      platform: params.platform,
    },
  });
  return { id: row.id, appId: row.appId };
};

export const unregisterDeviceTokenService = async (userId: string, token: string) => {
  await prisma.deviceToken.deleteMany({ where: { token, userId } });
  return { removed: true };
};

export const listNotificationsService = async (params: {
  userId: string;
  page: number;
  limit: number;
  unreadOnly?: boolean;
}) => {
  const where: Prisma.NotificationWhereInput = {
    userId: params.userId,
    ...(params.unreadOnly ? { readAt: null } : {}),
  };

  const [total, unread, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: params.userId, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { total, unread, page: params.page, limit: params.limit, notifications };
};

export const markNotificationReadService = async (userId: string, notificationId: string) => {
  // Scoped by userId so one user cannot mark another's notifications read.
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
  if (result.count === 0) throw notFound('Notification');
  return { id: notificationId };
};

export const markAllNotificationsReadService = async (userId: string) => {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
};
