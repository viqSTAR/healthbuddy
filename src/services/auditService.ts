import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { logger } from '../utils/logger.js';

export interface AuditInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Appends to the privileged-action log.
 *
 * Deliberately non-throwing: an audit write must never be the reason a role
 * grant or a report upload fails for a user. A failure here is logged loudly
 * so it surfaces in monitoring instead of disappearing.
 */
export const recordAudit = async (input: AuditInput): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (err) {
    logger.error(
      `[audit] failed to record ${input.action} on ${input.entityType}:${input.entityId}`,
      err
    );
  }
};

export const listAuditLogsService = async (params: {
  page: number;
  limit: number;
  entityType?: string;
  entityId?: string;
  action?: string;
}) => {
  const where: Prisma.AuditLogWhereInput = {
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.action ? { action: params.action } : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include: {
        actor: { select: { id: true, phoneNumber: true, role: true } },
      },
    }),
  ]);

  return { total, page: params.page, limit: params.limit, logs };
};
