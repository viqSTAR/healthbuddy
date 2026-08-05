import type { Request, Response } from 'express';
import type { PaymentMethod, PaymentPurpose } from '@prisma/client';
import {
  createCheckoutService,
  confirmPaymentService,
  handleWebhookService,
  markCodCollectedService,
  listMyPaymentsService,
  getPaymentService,
  listPartnerEarningsService,
} from '../services/paymentService.js';
import { mockHandoff } from '../services/payment/provider.js';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, notFound } from '../utils/AppError.js';
import {
  asyncHandler,
  requireUser,
  requirePatientId,
  requirePharmacyId,
  requireLabPartnerId,
  requireDoctorId,
  type AuthenticatedRequest,
} from '../middlewares/auth.js';

export const checkoutHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req);
  const body = req.body as { purpose: PaymentPurpose; targetId: string; method: PaymentMethod };

  const result = await createCheckoutService({
    userId: user.userId,
    patientId: requirePatientId(req),
    purpose: body.purpose,
    targetId: body.targetId,
    method: body.method,
    ipAddress: req.ip ?? null,
  });

  res.status(201).json({ success: true, ...result });
});

export const confirmPaymentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const body = req.body as { orderId: string; paymentId: string; signature: string };

    const result = await confirmPaymentService({
      orderId: body.orderId,
      paymentId: body.paymentId,
      signature: body.signature,
      userId: user.userId,
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ success: true, ...result });
  }
);

/**
 * The gateway's callback.
 *
 * Unauthenticated by necessity — the gateway has no session — so the signature
 * over the raw body is the only thing standing between this route and a forged
 * "payment succeeded". `express.raw` must be mounted here, because a body that
 * has been parsed and re-serialised no longer matches what was signed.
 */
export const webhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const signature =
    (req.headers['x-razorpay-signature'] as string | undefined) ??
    (req.headers['x-webhook-signature'] as string | undefined);

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const result = await handleWebhookService(raw, signature);

  res.status(200).json({ success: true, ...result });
});

export const markCodCollectedHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = requireUser(req);
    const { orderId } = req.params as { orderId: string };
    res.status(200).json({ success: true, ...(await markCodCollectedService(orderId, user.userId)) });
  }
);

export const listMyPaymentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const payments = await listMyPaymentsService(requireUser(req).userId);
    res.status(200).json({ success: true, count: payments.length, payments });
  }
);

export const getPaymentHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params as { id: string };
  const payment = await getPaymentService(id, requireUser(req).userId);
  res.status(200).json({ success: true, payment });
});

/** A partner's own settlement statement. */
export const myEarningsHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = requireUser(req);

  const earnings =
    user.role === 'PHARMACY'
      ? await listPartnerEarningsService('PHARMACY', requirePharmacyId(req))
      : user.role === 'LAB_PARTNER'
        ? await listPartnerEarningsService('LAB', requireLabPartnerId(req))
        : await listPartnerEarningsService('DOCTOR', requireDoctorId(req));

  res.status(200).json({ success: true, ...earnings });
});

/**
 * Development-only stand-in for the checkout sheet.
 *
 * Mints the same signature the real gateway would hand the client, so the app
 * can be driven end to end with no gateway account. Guarded twice: the provider
 * must be `mock`, and `mock` is refused outright when NODE_ENV=production.
 */
export const mockPayHandler = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (env.PAYMENT_PROVIDER !== 'mock') {
    throw new AppError('Simulated payments are disabled.', 404);
  }

  const user = requireUser(req);
  const { id } = req.params as { id: string };

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment || payment.userId !== user.userId) throw notFound('Payment');
  if (!payment.gatewayOrderId) {
    throw new AppError('This payment has no gateway order to simulate.', 400);
  }

  const { paymentId, signature } = mockHandoff(payment.gatewayOrderId);

  const result = await confirmPaymentService({
    orderId: payment.gatewayOrderId,
    paymentId,
    signature,
    userId: user.userId,
    ipAddress: req.ip ?? null,
  });

  res.status(200).json({ success: true, simulated: true, ...result });
});
