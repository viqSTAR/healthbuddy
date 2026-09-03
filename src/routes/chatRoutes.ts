import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  listThreadsService,
  getThreadService,
  sendMessageService,
  markThreadReadService,
  setThreadOpenService,
} from '../services/chatService.js';
import { prisma } from '../config/db.js';
import {
  authenticateJwt,
  authorizeRoles,
  asyncHandler,
  requireUser,
  requireDoctorId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';
import { validate, uuidSchema } from '../middlewares/validate.js';

const router = Router();

router.use(authenticateJwt);

/**
 * Resolves which side of the conversation the caller is.
 *
 * Both a patient and a doctor reach the same endpoints, and membership of the
 * specific thread is the real authorisation — a role check would be weaker,
 * since every doctor holds the DOCTOR role but only one is on this thread.
 */
const partyFor = async (req: AuthenticatedRequest) => {
  const { userId } = requireUser(req);
  const [patient, doctor] = await Promise.all([
    prisma.patient.findUnique({ where: { userId }, select: { id: true } }),
    prisma.doctor.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  return {
    userId,
    party: {
      ...(patient ? { patientId: patient.id } : {}),
      ...(doctor ? { doctorId: doctor.id } : {}),
    },
  };
};

router.get(
  '/threads',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, party } = await partyFor(req);
    const threads = await listThreadsService(userId, party);
    res.status(200).json({ success: true, count: threads.length, threads });
  })
);

router.get(
  '/threads/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { party } = await partyFor(req);
    const q = req.query as { page?: unknown; limit?: unknown };
    const thread = await getThreadService((req.params as { id: string }).id, party, {
      ...(q.page !== undefined ? { page: Number(q.page) } : {}),
      ...(q.limit !== undefined ? { limit: Number(q.limit) } : {}),
    });
    res.status(200).json({ success: true, thread });
  })
);

router.post(
  '/threads/:id/messages',
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ body: z.string().trim().min(1, 'Write a message.').max(2000) }),
  }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, party } = await partyFor(req);
    const message = await sendMessageService(
      (req.params as { id: string }).id,
      userId,
      party,
      (req.body as { body: string }).body
    );
    res.status(201).json({ success: true, message });
  })
);

router.post(
  '/threads/:id/read',
  validate({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId, party } = await partyFor(req);
    const result = await markThreadReadService((req.params as { id: string }).id, userId, party);
    res.status(200).json({ success: true, ...result });
  })
);

/**
 * The doctor opens or closes. Deliberately not available to the patient: the
 * entitlement is the doctor's to grant, and a patient able to extend it
 * indefinitely would recreate the unlimited channel this design avoids.
 */
router.patch(
  '/threads/:id/state',
  authorizeRoles('DOCTOR'),
  validate({
    params: z.object({ id: uuidSchema }),
    body: z.object({ open: z.boolean() }),
  }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const thread = await setThreadOpenService(
      (req.params as { id: string }).id,
      requireDoctorId(req),
      (req.body as { open: boolean }).open
    );
    res.status(200).json({ success: true, thread });
  })
);

export default router;
