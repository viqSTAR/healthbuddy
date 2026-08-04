import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  listMyTipsService,
  deliverTipsForPatientService,
  deliverTipsToAllPatientsService,
  listHealthTipsService,
  upsertHealthTipService,
} from '../services/healthContentService.js';
import {
  findNearbyServicesService,
  listServicesService,
  upsertServiceService,
  deleteServiceService,
} from '../services/emergencyDirectoryService.js';
import {
  asyncHandler,
  authenticateJwt,
  authorizeRoles,
  requirePatientId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';
import {
  validate,
  uuidSchema,
  paginationSchema,
  latitudeSchema,
  longitudeSchema,
} from '../middlewares/validate.js';

const router = Router();

const serviceTypes = [
  'AMBULANCE',
  'HOSPITAL',
  'BLOOD_BANK',
  'POISON_CONTROL',
  'MENTAL_HEALTH',
] as const;

/**
 * Emergency numbers are readable WITHOUT authentication.
 *
 * Someone in an emergency may have a locked-out session, an expired token, or
 * be holding a stranger's phone. Gating an ambulance number behind a login is
 * the wrong trade — nothing here is personal data.
 */
router.get(
  '/emergency-services',
  validate({
    query: z.object({
      latitude: z.coerce.number().pipe(latitudeSchema).optional(),
      longitude: z.coerce.number().pipe(longitudeSchema).optional(),
      city: z.string().trim().max(120).optional(),
      type: z.enum(serviceTypes).optional(),
      radiusKm: z.coerce.number().min(1).max(200).default(25),
    }),
  }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query as unknown as {
      latitude?: number;
      longitude?: number;
      city?: string;
      type?: (typeof serviceTypes)[number];
      radiusKm: number;
    };
    const result = await findNearbyServicesService(q);
    res.status(200).json({ success: true, ...result });
  })
);

router.use(authenticateJwt);

/* ---------- Patient health content ---------- */

router.get(
  '/tips/mine',
  authorizeRoles('PATIENT'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const tips = await listMyTipsService(requirePatientId(req));
    res.status(200).json({ success: true, count: tips.length, tips });
  })
);

/** Pulls any newly relevant tips — called when the patient opens the app. */
router.post(
  '/tips/refresh',
  authorizeRoles('PATIENT'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await deliverTipsForPatientService(requirePatientId(req));
    res.status(200).json({ success: true, ...result });
  })
);

/* ---------- Admin: authoring and directory management ---------- */

router.get(
  '/tips',
  authorizeRoles('ADMIN'),
  validate({ query: paginationSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    res.status(200).json({ success: true, ...(await listHealthTipsService(page, limit)) });
  })
);

router.put(
  '/tips',
  authorizeRoles('ADMIN'),
  validate({
    body: z.object({
      id: uuidSchema.optional(),
      title: z.string().trim().min(3).max(160),
      body: z.string().trim().min(10).max(2000),
      category: z.string().trim().min(2).max(80),
      audience: z.enum(['EVERYONE', 'CONDITION', 'ALLERGY', 'DIAGNOSIS', 'AGE_RANGE']),
      matchValues: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
      minAge: z.number().int().min(0).max(120).nullable().optional(),
      maxAge: z.number().int().min(0).max(120).nullable().optional(),
      priority: z.number().int().min(0).max(100).default(0),
      isActive: z.boolean().default(true),
    }),
  }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const tip = await upsertHealthTipService(req.body as never);
    res.status(200).json({ success: true, tip });
  })
);

router.post(
  '/tips/deliver-all',
  authorizeRoles('ADMIN'),
  asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({ success: true, ...(await deliverTipsToAllPatientsService()) });
  })
);

router.get(
  '/emergency-services/manage',
  authorizeRoles('ADMIN'),
  validate({
    query: paginationSchema.extend({
      type: z.enum(serviceTypes).optional(),
      city: z.string().trim().max(120).optional(),
    }),
  }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query as unknown as {
      page: number;
      limit: number;
      type?: (typeof serviceTypes)[number];
      city?: string;
    };
    res.status(200).json({ success: true, ...(await listServicesService(q)) });
  })
);

router.put(
  '/emergency-services',
  authorizeRoles('ADMIN'),
  validate({
    body: z.object({
      id: uuidSchema.optional(),
      name: z.string().trim().min(2).max(160),
      type: z.enum(serviceTypes),
      phone: z.string().trim().min(3).max(20),
      altPhone: z.string().trim().max(20).optional(),
      address: z.string().trim().max(300).optional(),
      city: z.string().trim().max(120).optional(),
      state: z.string().trim().max(120).optional(),
      pincode: z.string().trim().max(12).optional(),
      latitude: latitudeSchema.optional(),
      longitude: longitudeSchema.optional(),
      isNational: z.boolean().default(false),
      is24x7: z.boolean().default(true),
      notes: z.string().trim().max(500).optional(),
      isActive: z.boolean().default(true),
    }),
  }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const service = await upsertServiceService(req.body as never);
    res.status(200).json({ success: true, service });
  })
);

router.delete(
  '/emergency-services/:id',
  authorizeRoles('ADMIN'),
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    res.status(200).json({ success: true, ...(await deleteServiceService(id)) });
  })
);

export default router;
