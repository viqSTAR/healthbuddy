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
     */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(10),
    /** Lifetime of a signed download link. Short — these point at health data. */
    FILE_LINK_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === 's3' && !cfg.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3.',
      });
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
