import type { DocumentKind, Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { storage, buildStorageKey, signDocumentLink } from '../utils/storage.js';
import { assertDeclaredTypeMatchesBytes } from '../utils/fileType.js';
import { AppError, notFound } from '../utils/AppError.js';
import type { JwtPayload } from '../utils/jwt.js';
import { recordAudit } from './auditService.js';

/**
 * Documents that are health data rather than business paperwork. These carry
 * the stricter read rules in `canRead`.
 */
const CLINICAL_KINDS = new Set<DocumentKind>([
  'LAB_REPORT',
  'PRESCRIPTION_IMAGE',
  'CONDITION_PHOTO',
]);

export interface UploadInput {
  ownerUserId: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  applicationId?: string;
  labOrderId?: string;
  appointmentId?: string;
}

export const uploadDocumentService = async (input: UploadInput) => {
  /**
   * The allowlist is checked against the file's leading bytes, not against the
   * `Content-Type` the uploader sent — that header is attacker-controlled, so
   * checking it was checking their own claim. See utils/fileType.
   */
  const mimeType = assertDeclaredTypeMatchesBytes(input.mimeType, input.buffer);

  // An application may only receive documents from its own applicant, otherwise
  // one partner could attach files to another partner's pending application.
  if (input.applicationId) {
    const application = await prisma.providerApplication.findUnique({
      where: { id: input.applicationId },
      select: { userId: true, status: true },
    });
    if (!application || application.userId !== input.ownerUserId) {
      throw notFound('Application');
    }
    if (application.status === 'APPROVED') {
      throw new AppError('This application has already been approved.', 409);
    }
  }

  // Lab reports may only be attached by the lab actually handling the order.
  if (input.labOrderId) {
    const order = await prisma.labOrder.findUnique({
      where: { id: input.labOrderId },
      select: { labPartner: { select: { userId: true } } },
    });
    if (!order?.labPartner || order.labPartner.userId !== input.ownerUserId) {
      throw notFound('Lab order');
    }
  }

  // Condition photos may only be attached by the patient the appointment
  // belongs to — otherwise anyone could plant images in someone's record.
  if (input.appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: input.appointmentId },
      select: { status: true, patient: { select: { userId: true } } },
    });
    if (!appointment || appointment.patient.userId !== input.ownerUserId) {
      throw notFound('Appointment');
    }
    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
      throw new AppError('This consultation is closed.', 409);
    }
  }

  const storageKey = buildStorageKey(input.ownerUserId, input.fileName);
  await storage.put(storageKey, input.buffer, mimeType);

  try {
    const document = await prisma.document.create({
      data: {
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        storageKey,
        fileName: input.fileName.slice(0, 200),
        mimeType,
        sizeBytes: input.buffer.byteLength,
        ...(input.applicationId ? { applicationId: input.applicationId } : {}),
        ...(input.labOrderId ? { labOrderId: input.labOrderId } : {}),
        ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
      },
    });
    return toPublicDocument(document);
  } catch (err) {
    // Don't leave an orphaned blob behind if the row fails to write.
    await storage.remove(storageKey).catch(() => undefined);
    throw err;
  }
};

type DocumentRow = Prisma.DocumentGetPayload<Record<string, never>>;

/** `storageKey` is deliberately omitted — callers address documents by id. */
export const toPublicDocument = (doc: DocumentRow) => ({
  id: doc.id,
  kind: doc.kind,
  fileName: doc.fileName,
  mimeType: doc.mimeType,
  sizeBytes: doc.sizeBytes,
  createdAt: doc.createdAt,
});

/**
 * Decides whether `viewer` may read a document.
 *
 * Ordering matters: the cheap identity checks come first, and the expensive
 * treating-doctor lookup only runs for clinical documents.
 */
const canRead = async (documentId: string, viewer: JwtPayload): Promise<boolean> => {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      ownerUserId: true,
      kind: true,
      application: { select: { userId: true } },
      labOrder: {
        select: {
          patient: { select: { userId: true } },
          labPartner: { select: { userId: true } },
        },
      },
      appointment: {
        select: { doctorId: true, patient: { select: { userId: true } } },
      },
    },
  });

  if (!doc) return false;

  // The uploader always retains access to their own file.
  if (doc.ownerUserId === viewer.userId) return true;

  // Admins review licence documents; that is the whole point of the queue.
  if (viewer.role === 'ADMIN') return true;

  if (doc.labOrder) {
    // The patient the report belongs to.
    if (doc.labOrder.patient.userId === viewer.userId) return true;
    // The lab fulfilling the order.
    if (doc.labOrder.labPartner?.userId === viewer.userId) return true;
  }

  if (doc.appointment) {
    // The patient who attached the photo.
    if (doc.appointment.patient.userId === viewer.userId) return true;
    // The doctor consulting on that specific appointment — scoped to this
    // consultation, not to the patient in general.
    if (viewer.doctorId && doc.appointment.doctorId === viewer.doctorId) return true;
  }

  // A doctor may read a patient's clinical documents only while they have a
  // real consultation relationship with that patient.
  if (CLINICAL_KINDS.has(doc.kind) && viewer.role === 'DOCTOR' && viewer.doctorId) {
    const patientUserId = doc.labOrder?.patient.userId ?? doc.ownerUserId;
    const treating = await prisma.appointment.findFirst({
      where: {
        doctorId: viewer.doctorId,
        patient: { userId: patientUserId },
        status: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] },
      },
      select: { id: true },
    });
    if (treating) return true;
  }

  return false;
};

/**
 * Resolves a document for streaming. Returns 404 rather than 403 when the
 * viewer lacks access, so document ids cannot be probed for existence.
 */
export const openDocumentService = async (documentId: string, viewer: JwtPayload) => {
  if (!(await canRead(documentId, viewer))) throw notFound('Document');

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound('Document');

  await recordAudit({
    actorUserId: viewer.userId,
    action: 'document.read',
    entityType: 'Document',
    entityId: doc.id,
    metadata: { kind: doc.kind },
  });

  return { doc, stream: await storage.read(doc.storageKey) };
};

/** Streams a document addressed by a signed link instead of a Bearer token. */
export const openSignedDocumentService = async (documentId: string) => {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound('Document');
  return { doc, stream: await storage.read(doc.storageKey) };
};

/** Mints a short-lived URL for a viewer who has already passed the read check. */
export const createDocumentLinkService = async (documentId: string, viewer: JwtPayload) => {
  if (!(await canRead(documentId, viewer))) throw notFound('Document');
  const { token, expiresAt } = signDocumentLink(documentId);
  return {
    documentId,
    token,
    expiresAt,
    url: `/api/v1/files/${documentId}/signed?token=${token}`,
  };
};

export const deleteDocumentService = async (documentId: string, viewer: JwtPayload) => {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, ownerUserId: true, storageKey: true, application: { select: { status: true } } },
  });

  if (!doc || (doc.ownerUserId !== viewer.userId && viewer.role !== 'ADMIN')) {
    throw notFound('Document');
  }
  if (doc.application?.status === 'APPROVED') {
    throw new AppError('Documents on an approved application cannot be removed.', 409);
  }

  await prisma.document.delete({ where: { id: doc.id } });
  await storage.remove(doc.storageKey).catch(() => undefined);
  return { id: doc.id };
};
