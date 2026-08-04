import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  uploadDocumentHandler,
  downloadDocumentHandler,
  downloadSignedDocumentHandler,
  createDocumentLinkHandler,
  deleteDocumentHandler,
} from '../controllers/documentController.js';
import { authenticateJwt } from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';
import { env } from '../config/env.js';

const router = Router();

/**
 * Files are held in memory only long enough to hand them to the storage
 * driver — nothing is written to a temp directory where it would outlive the
 * request. The size cap is enforced here so an oversized upload is rejected
 * before it is fully buffered.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

const documentKinds = [
  'DOCTOR_REGISTRATION_CERT',
  'DOCTOR_QUALIFICATION',
  'DRUG_LICENCE',
  'PHARMACIST_CERT',
  'LAB_REGISTRATION',
  'NABL_CERTIFICATE',
  'GST_CERTIFICATE',
  'SHOP_ESTABLISHMENT',
  'ID_PROOF',
  'PREMISES_PHOTO',
  'LAB_REPORT',
  'PRESCRIPTION_IMAGE',
  'CONDITION_PHOTO',
  'PROFILE_PHOTO',
] as const;

/**
 * Signed downloads are mounted BEFORE the auth guard: the signature is the
 * credential. Everything else on this router requires a Bearer token.
 */
router.get(
  '/:id/signed',
  validate({ params: z.object({ id: uuidSchema }) }),
  downloadSignedDocumentHandler
);

router.use(authenticateJwt);

router.post(
  '/',
  upload.single('file'),
  validate({
    body: z.object({
      kind: z.enum(documentKinds),
      applicationId: uuidSchema.optional(),
      labOrderId: uuidSchema.optional(),
      appointmentId: uuidSchema.optional(),
    }),
  }),
  uploadDocumentHandler
);

router.get('/:id', validate({ params: z.object({ id: uuidSchema }) }), downloadDocumentHandler);

router.post(
  '/:id/link',
  validate({ params: z.object({ id: uuidSchema }) }),
  createDocumentLinkHandler
);

router.delete('/:id', validate({ params: z.object({ id: uuidSchema }) }), deleteDocumentHandler);

export default router;
