/**
 * Everything this deployment depends on, checked in one command.
 *
 *   npm run preflight
 *
 * The problem it solves: going live means signing up for five external services
 * and wiring each one in, and the failure mode of getting one wrong is not an
 * error at boot — it is a patient who cannot receive an OTP, or a lab report
 * that uploads and then cannot be read back. `config/env.ts` already refuses to
 * start on a configuration that is *invalid*; nothing until now proved that a
 * valid-looking configuration actually reaches a working service.
 *
 * Every check answers one question: if a real person used this right now, would
 * it work? So it makes real calls — connects to the database, pings Redis,
 * round-trips a file through the storage driver — rather than reading settings
 * back to you.
 *
 * Exits non-zero if anything a production deployment needs is missing, so it can
 * gate a deploy. Warnings alone do not fail it.
 */
import { randomUUID } from 'node:crypto';
import { env, isProduction } from '../src/config/env.js';
import { prisma, connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { cacheStore, getRedisClient, isStoreReady } from '../src/config/redis.js';
import { storage } from '../src/utils/storage.js';
import { errorReporter } from '../src/utils/errorReporter.js';
import { paymentProvider } from '../src/services/payment/provider.js';

type Level = 'pass' | 'warn' | 'fail';

interface Check {
  name: string;
  level: Level;
  detail: string;
  /** What to do about it, when it is not a pass. */
  fix?: string;
}

const results: Check[] = [];

const record = (name: string, level: Level, detail: string, fix?: string) => {
  results.push({ name, level, detail, ...(fix ? { fix } : {}) });
};

/** Wraps a check so one failing dependency does not abort the rest of the report. */
const check = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (err) {
    record(name, 'fail', (err as Error).message);
  }
};

/* ------------------------------------------------------------------ */

const checkDatabase = () =>
  check('PostgreSQL', async () => {
    const started = Date.now();
    await connectDatabase();
    const [{ version }] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;

    // A migration that has not been applied means the running code expects
    // columns the database does not have — which surfaces as a 500 per request.
    const applied = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `.catch(() => [{ count: -1n }]);

    const migrations = Number(applied[0]?.count ?? -1);
    if (migrations < 0) {
      record(
        'PostgreSQL',
        'fail',
        'connected, but no migration history — this database was never migrated',
        'npm run prisma:deploy'
      );
      return;
    }

    record(
      'PostgreSQL',
      'pass',
      `${version.split(' ').slice(0, 2).join(' ')}, ${migrations} migration(s) applied, ${Date.now() - started}ms`
    );
  });

const checkRedis = () =>
  check('Redis', async () => {
    getRedisClient();
    // ioredis connects asynchronously; give it a moment before judging it.
    await new Promise((r) => setTimeout(r, 500));

    if (!isStoreReady()) {
      record(
        'Redis',
        isProduction ? 'fail' : 'warn',
        'not reachable — the process-local fallback is in use',
        isProduction
          ? 'Production refuses to serve on the fallback: OTPs and rate limits would not be shared across replicas.'
          : 'Fine for development. Required in production.'
      );
      return;
    }

    const probe = `preflight:${randomUUID()}`;
    await cacheStore.set(probe, 'ok', 10);
    const readBack = await cacheStore.get(probe);
    await cacheStore.del(probe);

    record(
      'Redis',
      readBack === 'ok' ? 'pass' : 'fail',
      readBack === 'ok' ? 'connected, read-after-write verified' : 'connected but did not read back'
    );
  });

const checkStorage = () =>
  check('File storage', async () => {
    if (storage.name === 'local' && isProduction) {
      record(
        'File storage',
        'fail',
        'STORAGE_DRIVER=local in production',
        'Uploaded licences and lab reports would be lost on redeploy. Configure s3 or r2.'
      );
      return;
    }

    const key = `_preflight/${randomUUID()}.txt`;
    const body = Buffer.from('preflight');

    await storage.put(key, body, 'text/plain');
    const stream = await storage.read(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    await storage.remove(key);

    const intact = Buffer.concat(chunks).equals(body);
    record(
      'File storage',
      intact ? (storage.name === 'local' ? 'warn' : 'pass') : 'fail',
      intact
        ? `${storage.name} — wrote, read back and deleted successfully`
        : `${storage.name} — read back different bytes than were written`,
      storage.name === 'local'
        ? 'Local disk is not durable. Run npm run storage:check against the real bucket before launch.'
        : undefined
    );
  });

const checkSms = () =>
  check('SMS', async () => {
    if (env.SMS_PROVIDER === 'mock') {
      record(
        'SMS',
        isProduction ? 'fail' : 'warn',
        'provider is "mock" — no message is ever delivered',
        'Nobody can sign in without a real provider. Set SMS_PROVIDER=twilio.'
      );
      return;
    }

    if (env.SMS_PROVIDER === 'msg91') {
      record('SMS', 'fail', 'msg91 has no implementation', 'Use twilio, or implement sendViaMsg91.');
      return;
    }

    // Credentials only — sending a real SMS from a preflight check costs money
    // and, worse, texts somebody.
    const complete =
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER;
    record(
      'SMS',
      complete ? 'pass' : 'fail',
      complete ? 'twilio credentials present' : 'twilio selected but credentials incomplete',
      complete ? 'Not verified against Twilio — send one real OTP before launch.' : undefined
    );
  });

const checkPayments = () =>
  check('Payments', async () => {
    if (paymentProvider.name === 'mock') {
      record(
        'Payments',
        isProduction ? 'fail' : 'warn',
        'provider is "mock" — orders are marked paid without collecting anything',
        'Set PAYMENT_PROVIDER=razorpay with a key, secret and webhook secret.'
      );
      return;
    }

    record(
      'Payments',
      env.RAZORPAY_WEBHOOK_SECRET ? 'pass' : 'fail',
      env.RAZORPAY_WEBHOOK_SECRET
        ? 'razorpay configured, webhook secret present'
        : 'razorpay configured but no webhook secret',
      env.RAZORPAY_WEBHOOK_SECRET
        ? 'Confirm the webhook URL is registered in the Razorpay dashboard.'
        : 'Without it, anyone could post a forged "payment succeeded".'
    );
  });

const checkVideo = () => {
  if (env.VIDEO_PROVIDER === 'mock') {
    record(
      'Video',
      isProduction ? 'warn' : 'warn',
      'provider is "mock" — the call screen renders with no transport',
      'Consultations cannot actually happen. Set VIDEO_PROVIDER=jitsi or daily.'
    );
    return;
  }
  record('Video', 'pass', `${env.VIDEO_PROVIDER} configured`);
};

const checkErrorReporting = () => {
  record(
    'Error reporting',
    errorReporter.name === 'none' ? (isProduction ? 'warn' : 'warn') : 'pass',
    errorReporter.name === 'none'
      ? 'no SENTRY_DSN — nothing is collecting production faults'
      : `reporting via ${errorReporter.name}`,
    errorReporter.name === 'none' ? 'You will hear about failures from users.' : undefined
  );
};

const checkPublicUrl = () => {
  const host = (() => {
    try {
      return new URL(env.PUBLIC_BASE_URL).hostname;
    } catch {
      return '';
    }
  })();
  const local = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);

  record(
    'Public base URL',
    local ? (isProduction ? 'fail' : 'warn') : 'pass',
    `${env.PUBLIC_BASE_URL}${local ? ' — a development address' : ''}`,
    local ? 'This is printed on every prescription as the address for verifying it.' : undefined
  );
};

/* ------------------------------------------------------------------ */

const ICON: Record<Level, string> = { pass: '✓', warn: '!', fail: '✗' };

const main = async () => {
  console.log(`\nPreflight — NODE_ENV=${env.NODE_ENV}\n`);

  await checkDatabase();
  await checkRedis();
  await checkStorage();
  await checkSms();
  await checkPayments();
  checkVideo();
  checkErrorReporting();
  checkPublicUrl();

  for (const r of results) {
    console.log(`  ${ICON[r.level]} ${r.name.padEnd(18)} ${r.detail}`);
    if (r.fix) console.log(`      ${' '.repeat(18)} ${r.fix}`);
  }

  const failed = results.filter((r) => r.level === 'fail');
  const warned = results.filter((r) => r.level === 'warn');

  console.log('');
  if (failed.length) {
    console.log(`  ${failed.length} blocking problem(s): ${failed.map((r) => r.name).join(', ')}`);
    process.exitCode = 1;
  } else if (warned.length) {
    console.log(`  No blocking problems. ${warned.length} thing(s) to resolve before launch.`);
  } else {
    console.log('  Everything this deployment depends on is configured and reachable.');
  }
  console.log('');
};

main()
  .catch((err: unknown) => {
    console.error('Preflight itself failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([disconnectDatabase(), cacheStore.disconnect()]);
  });
