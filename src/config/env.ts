import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Secrets that shipped in git history / .env.example. Refused outright so a
 * rotated deployment can never silently fall back to a publicly known key.
 */
const COMPROMISED_SECRETS = new Set([
  'healthbuddy_super_secret_access_token_key_2026_prod',
  'healthbuddy_super_secret_refresh_token_key_2026_prod',
]);

const jwtSecret = (label: string) =>
  z
    .string({ error: `${label} is required. Generate one with: openssl rand -hex 32` })
    .min(32, `${label} must be at least 32 characters.`)
    .refine((v) => !COMPROMISED_SECRETS.has(v), {
      message: `${label} is a known-compromised placeholder value. Generate a new one with: openssl rand -hex 32`,
    });

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(5000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
    /**
     * Unpooled connection for schema changes. Only the Prisma CLI reads it —
     * the runtime uses the pooled DATABASE_URL.
     */
    DIRECT_URL: z.string().optional(),

    REDIS_HOST: z.string().default('127.0.0.1'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional().default(''),
    REDIS_TLS: z.enum(['true', 'false']).default('false'),

    JWT_ACCESS_SECRET: jwtSecret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: jwtSecret('JWT_REFRESH_SECRET'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    SMS_PROVIDER: z.enum(['mock', 'twilio', 'msg91']).default('mock'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_PHONE_NUMBER: z.string().optional(),

    /**
     * Returns the OTP in the HTTP response. Catastrophic in production, so it
     * is opt-in by explicit flag and hard-blocked below when NODE_ENV=production
     * rather than being keyed off NODE_ENV's default value.
     */
    EXPOSE_DEV_OTP: z.enum(['true', 'false']).default('false'),

    /** Comma-separated allowlist. Empty means "reflect any origin" (dev only). */
    CORS_ORIGINS: z.string().optional().default(''),

    /**
     * File storage. "local" writes under UPLOAD_DIR and is fine for development;
     * production needs durable object storage, so it is rejected below.
     * "r2" and "s3" share one driver — R2 speaks the S3 API.
     */
    STORAGE_DRIVER: z.enum(['local', 's3', 'r2']).default('local'),
    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(10),
    /** Lifetime of a signed download link. Short — these point at health data. */
    FILE_LINK_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** Cloudflare account id. Present ⇒ the endpoint and region are derived. */
    R2_ACCOUNT_ID: z.string().optional(),

    /* ---------- Money ---------- */

    /**
     * "mock" settles locally with a deterministic signature so the whole
     * checkout → pay → split → refund path is testable with no gateway account.
     * It never moves money and is rejected in production.
     */
    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    /** Set in the Razorpay dashboard; verifies webhook authenticity. */
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    /** Platform commission, in percent, per payee type. */
    COMMISSION_PHARMACY_PCT: z.coerce.number().min(0).max(50).default(10),
    COMMISSION_LAB_PCT: z.coerce.number().min(0).max(50).default(15),
    /**
     * A platform facilitation fee on a consult, not a share of the clinical
     * fee — see the note in paymentService about fee-splitting.
     */
    COMMISSION_DOCTOR_PCT: z.coerce.number().min(0).max(50).default(10),

    /** Cash on delivery. Switchable because it carries real fraud cost. */
    COD_ENABLED: z.enum(['true', 'false']).default('true'),
    /** Above this basket value COD is refused — the loss on a bad order hurts. */
    COD_MAX_ORDER_VALUE: z.coerce.number().positive().default(5000),

    /* ---------- Video consultations ---------- */

    /**
     * "mock" renders the call shell with no transport (the pre-existing
     * behaviour). "jitsi" and "daily" both hand back a URL a plain browser can
     * open, which is what makes them testable in Expo Go — a native WebRTC SDK
     * would need a development build.
     */
    VIDEO_PROVIDER: z.enum(['mock', 'jitsi', 'daily']).default('mock'),
    /**
     * meet.jit.si requires the *first* participant to sign in with Google,
     * GitHub or Facebook before a room opens; later participants join freely.
     * Point this at your own deployment to drop that requirement.
     */
    JITSI_DOMAIN: z.string().default('meet.jit.si'),
    DAILY_API_KEY: z.string().optional(),
    /** The <name> in https://<name>.daily.co. Shown on the Daily dashboard. */
    DAILY_SUBDOMAIN: z.string().optional(),
    /** Minutes before the slot that the room opens. */
    VIDEO_JOIN_LEAD_MINUTES: z.coerce.number().int().positive().max(120).default(10),
    /** Minutes after the slot start that the room stops accepting joins. */
    VIDEO_JOIN_GRACE_MINUTES: z.coerce.number().int().positive().max(360).default(60),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER !== 'local') {
      if (!cfg.S3_BUCKET) {
        ctx.addIssue({
          code: 'custom',
          path: ['S3_BUCKET'],
          message: `S3_BUCKET is required when STORAGE_DRIVER=${cfg.STORAGE_DRIVER}.`,
        });
      }
      if (!cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['S3_ACCESS_KEY_ID'],
          message:
            'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for object storage. For R2 these are the Access Key ID and Secret Access Key from an R2 API token.',
        });
      }
      if (cfg.STORAGE_DRIVER === 'r2' && !cfg.R2_ACCOUNT_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['R2_ACCOUNT_ID'],
          message:
            'R2_ACCOUNT_ID is required when STORAGE_DRIVER=r2 — it forms the endpoint https://<id>.r2.cloudflarestorage.com.',
        });
      }
      if (cfg.STORAGE_DRIVER === 's3' && !cfg.S3_REGION && !cfg.S3_ENDPOINT) {
        ctx.addIssue({
          code: 'custom',
          path: ['S3_REGION'],
          message: 'S3_REGION or S3_ENDPOINT is required when STORAGE_DRIVER=s3.',
        });
      }
    }

    if (cfg.VIDEO_PROVIDER === 'daily' && !cfg.DAILY_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['DAILY_API_KEY'],
        message: 'DAILY_API_KEY is required when VIDEO_PROVIDER=daily.',
      });
    }

    if (cfg.PAYMENT_PROVIDER === 'razorpay') {
      if (!cfg.RAZORPAY_KEY_ID || !cfg.RAZORPAY_KEY_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAY_KEY_ID'],
          message:
            'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay.',
        });
      }
      if (!cfg.RAZORPAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAY_WEBHOOK_SECRET'],
          message:
            'RAZORPAY_WEBHOOK_SECRET is required — without it any caller could post a forged "payment succeeded" webhook and release an unpaid order to a partner.',
        });
      }
    }

    if (cfg.NODE_ENV === 'production') {
      if (cfg.STORAGE_DRIVER === 'local') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message:
            'STORAGE_DRIVER=local is not durable in production — uploaded licences and lab reports would be lost on redeploy. Configure s3.',
        });
      }
      if (cfg.EXPOSE_DEV_OTP === 'true') {
        ctx.addIssue({
          code: 'custom',
          path: ['EXPOSE_DEV_OTP'],
          message: 'EXPOSE_DEV_OTP must be false in production — it leaks the OTP to any caller.',
        });
      }
      if (cfg.SMS_PROVIDER === 'mock') {
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_PROVIDER'],
          message: 'SMS_PROVIDER cannot be "mock" in production — no OTP would ever be delivered.',
        });
      }
      if (cfg.PAYMENT_PROVIDER === 'mock') {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_PROVIDER'],
          message:
            'PAYMENT_PROVIDER cannot be "mock" in production — it marks orders paid without collecting anything.',
        });
      }
      if (!cfg.CORS_ORIGINS.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS must list explicit origins in production.',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Fail loudly at boot rather than starting with an insecure configuration.
  console.error(`\n[FATAL] Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Origins allowed by CORS, or null to reflect the request origin (dev only). */
export const corsOrigins: string[] | null = env.CORS_ORIGINS.trim()
  ? env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : null;
