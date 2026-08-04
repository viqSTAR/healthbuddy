import type { Response } from 'express';
import type { DocumentKind } from '@prisma/client';
import {
  uploadDocumentService,
  openDocumentService,
  openSignedDocumentService,
  createDocumentLinkService,
  deleteDocumentService,
} from '../services/documentService.js';
import { verifyDocumentLink } from '../utils/storage.js';
import { asyncHandler, requireUser, type AuthenticatedRequest } from '../middlewares/auth.js';
import { AppError, notFound } from '../utils/AppError.js';

interface UploadRequest extends AuthenticatedRequest {
  file?: Express.Multer.File;
}

export const uploadDocumentHandler = asyncHandler(async (req: UploadRequest, res: Response) => {
  const user = requireUser(req);
  if (!req.file) throw new AppError('No file was uploaded. Send it as the "file" field.', 400);

  const { kind, applicationId, labOrderId, appointmentId } = req.body as {
    kind: DocumentKind;
    applicationId?: string;
    labOrderId?: string;
    appointmentId?: string;
  };

  const document = await uploadDocumentService({
    ownerUserId: user.userId,
    kind,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
    ...(applicationId ? { applicationId } : {}),
    ...(labOrderId ? { labOrderId } : {}),
    ...(appointmentId ? { appointmentId } : {}),
  });

  res.status(201).json({ success: true, document });
});

/**
 * Streams a document to an authenticated caller. `no-store` keeps health data
 * out of shared caches, and the inline disposition lets clients render it.
 */
export const downloadDocumentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const { doc, stream } = await openDocumentService(id, user);

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.sizeBytes));
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    stream.pipe(res);
  }
);

/**
 * Streams a document addressed by a signed link. Authorisation happened when
 * the link was minted; this only re-checks the signature and expiry.
 */
export const downloadSignedDocumentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const { token } = req.query as { token?: string };

    // 404 rather than 403 so a bad token cannot confirm a document exists.
    if (!token || !verifyDocumentLink(id, token)) throw notFound('Document');

    const { doc, stream } = await openSignedDocumentService(id);

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.sizeBytes));
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    stream.pipe(res);
  }
);

export const createDocumentLinkHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    res.status(200).json({ success: true, link: await createDocumentLinkService(id, user) });
  }
);

export const deleteDocumentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await deleteDocumentService(id, user);
    res.status(200).json({ success: true, message: 'Document removed.' });
  }
);
