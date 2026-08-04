/**
 * Pins the test environment BEFORE any application module is imported.
 *
 * config/env.ts reads process.env at import time and dotenv does not override
 * values already set, so this must be loaded first — hence the `--import` flag
 * ahead of the test files in package.json.
 *
 * Without this the suite runs as NODE_ENV=development, which leaves the per-IP
 * OTP verify limiter active. Every test shares one source IP, so the eleventh
 * login in a 15-minute window starts failing with a 429 that has nothing to do
 * with the behaviour under test.
 */
process.env.NODE_ENV = 'test';

// The suite reads the code out of the send-otp response instead of an SMS.
process.env.EXPOSE_DEV_OTP = 'true';
process.env.SMS_PROVIDER = 'mock';

// Keep uploaded test fixtures out of the real upload directory.
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOAD_DIR = './.test-uploads';
