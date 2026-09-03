import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { MOCK_PAYMENT_KEY } from '../../utils/secrets.js';
import { AppError } from '../../utils/AppError.js';

/**
 * The payment gateway, behind one interface.
 *
 * Two implementations: `mock`, which is a complete offline simulation so the
 * whole checkout → pay → split → refund path is testable with no account at
 * all, and `razorpay`, which talks to a licensed aggregator.
 *
 * Why an aggregator rather than collecting into a platform account and paying
 * partners out later: the second design makes the platform a payment
 * aggregator in the RBI's sense, which requires authorisation under the PA/PG
 * guidelines. Route (Razorpay) / Easy Split (Cashfree) let the *licensed* party
 * hold and split the money, which is the arrangement quick-commerce
 * marketplaces run on.
 */

/* ------------------------------------------------------------------ *
 * Money
 *
 * Gateways deal in integer minor units. Rupee floats drifting through
 * arithmetic is how a basket ends up charged 999.9999999, so every amount
 * crosses this boundary as an integer number of paise.
 * ------------------------------------------------------------------ */

export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const fromPaise = (paise: number): number => Number((paise / 100).toFixed(2));

export interface TransferLeg {
  /** The payee's linked account at the gateway. */
  account: string;
  /** Integer paise. */
  amount: number;
  notes?: Record<string, string>;
}

export interface CreateOrderInput {
  /** Integer paise. */
  amount: number;
  currency: string;
  /** Our own reference, echoed back on the webhook. */
  receipt: string;
  notes?: Record<string, string>;
  /** Settlement legs. Omitted when no partner has onboarded for payouts yet. */
  transfers?: TransferLeg[];
}

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  /** Public key the mobile client needs to open the checkout sheet. */
  publicKey: string | null;
}

export interface HandoffProof {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  orderId: string | null;
  paymentId: string | null;
  /** Integer paise, when the event carries an amount. */
  amount: number | null;
  failureReason: string | null;
  payload: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(input: CreateOrderInput): Promise<GatewayOrder>;
  /** Verifies the signature the checkout sheet hands back to the client. */
  verifyHandoff(proof: HandoffProof): boolean;
  /** Verifies a webhook against the raw, unparsed body. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;
  parseWebhook(rawBody: Buffer): WebhookEvent;
  refund(paymentId: string, amountPaise: number, reason: string): Promise<{ refundId: string }>;
}

/** Constant-time compare that tolerates length differences without throwing. */
const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/* ------------------------------------------------------------------ *
 * Mock
 * ------------------------------------------------------------------ */

/**
 * Simulates a gateway end to end. Signatures are real HMACs — the verification
 * code under test is the same code that runs in production, so a broken
 * signature check fails the tests rather than passing silently.
 *
 * Rejected at boot when NODE_ENV=production (see config/env.ts): this marks
 * orders paid without collecting anything.
 */
const mockProvider = (): PaymentProvider => {
  const sign = (payload: string) =>
    createHmac('sha256', MOCK_PAYMENT_KEY).update(payload).digest('hex');

  return {
    name: 'mock',

    async createOrder(input) {
      return {
        id: `order_mock_${randomUUID().replace(/-/g, '')}`,
        amount: input.amount,
        currency: input.currency,
        publicKey: 'mock_key',
      };
    },

    verifyHandoff({ orderId, paymentId, signature }) {
      return safeEqual(signature, sign(`${orderId}|${paymentId}`));
    },

    verifyWebhook(rawBody, signature) {
      if (!signature) return false;
      return safeEqual(signature, sign(rawBody.toString('utf8')));
    },

    parseWebhook(rawBody) {
      const body = JSON.parse(rawBody.toString('utf8')) as {
        event?: string;
        id?: string;
        orderId?: string;
        paymentId?: string;
        amount?: number;
        reason?: string;
      };
      return {
        eventId: body.id ?? sign(rawBody.toString('utf8')).slice(0, 32),
        eventType: body.event ?? 'payment.captured',
        orderId: body.orderId ?? null,
        paymentId: body.paymentId ?? null,
        amount: body.amount ?? null,
        failureReason: body.reason ?? null,
        payload: body,
      };
    },

    async refund(paymentId) {
      return { refundId: `rfnd_mock_${paymentId.slice(-8)}_${Date.now()}` };
    },
  };
};

/** Test/dev helper: mints what the real checkout sheet would hand the client. */
export const mockHandoff = (orderId: string): { paymentId: string; signature: string } => {
  const paymentId = `pay_mock_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const signature = createHmac('sha256', MOCK_PAYMENT_KEY)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return { paymentId, signature };
};

/* ------------------------------------------------------------------ *
 * Razorpay
 * ------------------------------------------------------------------ */

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const razorpayProvider = (): PaymentProvider => {
  const keyId = env.RAZORPAY_KEY_ID!;
  const keySecret = env.RAZORPAY_KEY_SECRET!;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET!;
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${RAZORPAY_API}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError('Could not reach the payment provider. Please try again.', 503);
    }

    const text = await res.text();
    if (!res.ok) {
      const description =
        (JSON.parse(text || '{}') as { error?: { description?: string } }).error?.description ??
        'The payment provider rejected the request.';
      // 4xx from the gateway is usually our own bad request, not the payer's,
      // so it must not be reported to the client as their mistake.
      throw new AppError(description, res.status >= 500 ? 502 : 400);
    }
    return JSON.parse(text) as T;
  };

  return {
    name: 'razorpay',

    async createOrder(input) {
      const order = await call<{ id: string; amount: number; currency: string }>('/orders', {
        amount: input.amount,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
        // Route: the aggregator splits at settlement, so the platform never
        // holds the partner's money.
        transfers: input.transfers?.map((t) => ({
          account: t.account,
          amount: t.amount,
          currency: input.currency,
          notes: t.notes,
          // Held until we release it would strand a partner's money on a
          // dispute we have no process for. Settle on schedule instead.
          on_hold: false,
        })),
      });

      return {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        publicKey: keyId,
      };
    },

    verifyHandoff({ orderId, paymentId, signature }) {
      const expected = createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
      return safeEqual(signature, expected);
    },

    verifyWebhook(rawBody, signature) {
      if (!signature) return false;
      const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      return safeEqual(signature, expected);
    },

    parseWebhook(rawBody) {
      const body = JSON.parse(rawBody.toString('utf8')) as {
        event?: string;
        payload?: {
          payment?: {
            entity?: {
              id?: string;
              order_id?: string;
              amount?: number;
              error_description?: string;
            };
          };
        };
      };
      const payment = body.payload?.payment?.entity;

      return {
        // Razorpay sends x-razorpay-event-id in the header, but the body is what
        // is signed; hashing it gives a stable id either way.
        eventId: createHmac('sha256', webhookSecret).update(rawBody).digest('hex').slice(0, 32),
        eventType: body.event ?? 'unknown',
        orderId: payment?.order_id ?? null,
        paymentId: payment?.id ?? null,
        amount: payment?.amount ?? null,
        failureReason: payment?.error_description ?? null,
        payload: body,
      };
    },

    async refund(paymentId, amountPaise, reason) {
      const refund = await call<{ id: string }>(`/payments/${paymentId}/refund`, {
        amount: amountPaise,
        notes: { reason: reason.slice(0, 250) },
        speed: 'normal',
      });
      return { refundId: refund.id };
    },
  };
};

export const paymentProvider: PaymentProvider =
  env.PAYMENT_PROVIDER === 'razorpay' ? razorpayProvider() : mockProvider();
