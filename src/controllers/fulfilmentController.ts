import type { Response } from 'express';
import type { PaymentMethod } from '@prisma/client';
import {
  listMyFulfilmentsService,
  getFulfilmentService,
  consentToFulfilmentService,
  declineFulfilmentService,
  expireStaleFulfilmentsService,
} from '../services/fulfilmentService.js';
import {
  asyncHandler,
  requirePatientId,
  requireUser,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const listMyFulfilmentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const fulfilments = await listMyFulfilmentsService(requirePatientId(req));
    res.status(200).json({ success: true, count: fulfilments.length, fulfilments });
  }
);

export const getFulfilmentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params as { id: string };
    const fulfilment = await getFulfilmentService(id, requirePatientId(req));
    res.status(200).json({ success: true, fulfilment });
  }
);

/** The consent action — the only thing that turns a prescription into orders. */
export const consentHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const patientId = requirePatientId(req);
  const { id } = req.params as { id: string };
  const body = req.body as {
    acceptMedicineIds?: string[];
    acceptLabPackageIds?: string[];
    deliveryAddress: string;
    latitude?: number;
    longitude?: number;
    paymentMethod: PaymentMethod;
  };

  const result = await consentToFulfilmentService({
    fulfilmentId: id,
    patientId,
    userId: requireUser(req).userId,
    ...(body.acceptMedicineIds ? { acceptMedicineIds: body.acceptMedicineIds } : {}),
    ...(body.acceptLabPackageIds ? { acceptLabPackageIds: body.acceptLabPackageIds } : {}),
    deliveryAddress: body.deliveryAddress,
    ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
    ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
    paymentMethod: body.paymentMethod,
    ipAddress: req.ip ?? null,
  });

  res.status(201).json({ success: true, ...result });
});

export const declineHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const patientId = requirePatientId(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason?: string };
  res.status(200).json({ success: true, ...(await declineFulfilmentService(id, patientId, reason)) });
});

export const expireStaleHandler = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({ success: true, ...(await expireStaleFulfilmentsService()) });
});
