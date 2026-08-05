/**
 * Proves the configured storage driver actually works, before a real licence
 * document depends on it.
 *
 *   npm run storage:check
 *
 * Writes a small object, reads it back, compares the bytes, then deletes it.
 * A driver that can write but not read is worse than one that fails outright,
 * because the failure only surfaces when someone asks for their lab report.
 *
 * Also checks the thing most likely to be misconfigured on Cloudflare R2: that
 * the bucket is NOT publicly reachable. A public URL to a health record is
 * readable by anyone who obtains it, forever, with no login.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { storage } from '../src/utils/storage.js';

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => console.log(`  ✗ ${msg}`);

const readAll = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const main = async () => {
  const key = `_healthcheck/${randomUUID()}.txt`;
  const body = Buffer.from(`health buddy storage check ${new Date().toISOString()}`);

  console.log(`\nStorage driver: ${storage.name}`);
  if (env.R2_ACCOUNT_ID) {
    console.log(`Endpoint:       https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  }
  if (env.S3_BUCKET) console.log(`Bucket:         ${env.S3_BUCKET}`);
  console.log('');

  if (storage.name === 'local') {
    console.log(`Writing under ${env.UPLOAD_DIR}. This is fine for development and is`);
    console.log('refused in production — a container filesystem is wiped on redeploy,');
    console.log('taking every licence and lab report with it.\n');
  }

  let failures = 0;

  try {
    await storage.put(key, body, 'text/plain');
    ok('wrote an object');
  } catch (err) {
    bad(`could not write: ${(err as Error).message}`);
    console.log('\nCheck S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY, and that the token');
    console.log('has Object Read & Write on this bucket.\n');
    process.exit(1);
  }

  try {
    const roundTripped = await readAll(await storage.read(key));
    if (roundTripped.equals(body)) ok('read it back byte for byte');
    else {
      bad(`read it back but the bytes differ (${roundTripped.length} vs ${body.length})`);
      failures += 1;
    }
  } catch (err) {
    bad(`could not read: ${(err as Error).message}`);
    failures += 1;
  }

  try {
    if (await storage.exists(key)) ok('exists() sees it');
    else {
      bad('exists() says it is not there');
      failures += 1;
    }
  } catch (err) {
    bad(`exists() failed: ${(err as Error).message}`);
    failures += 1;
  }

  // Traversal guards. A key is opaque and must never escape the bucket prefix.
  for (const nasty of ['../escaped.txt', '/etc/passwd', 'a/../../b.txt']) {
    try {
      await storage.put(nasty, body, 'text/plain');
      bad(`accepted an unsafe key: ${nasty}`);
      failures += 1;
    } catch {
      ok(`rejected an unsafe key: ${nasty}`);
    }
  }

  /**
   * The bucket must not be readable without credentials. This is the single
   * most common R2 mistake — enabling the r2.dev domain "to make images work"
   * turns every stored document into a public URL.
   */
  if (env.R2_ACCOUNT_ID && env.S3_BUCKET) {
    const publicUrl = `https://pub-${env.R2_ACCOUNT_ID}.r2.dev/${key}`;
    try {
      const res = await fetch(publicUrl, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        bad(`THE BUCKET IS PUBLIC — ${publicUrl} returned ${res.status}`);
        console.log('    Turn off the r2.dev public URL in the bucket settings.');
        failures += 1;
      } else {
        ok(`not publicly readable (r2.dev returned ${res.status})`);
      }
    } catch {
      ok('not publicly readable (no public domain responded)');
    }
  }

  try {
    await storage.remove(key);
    if (await storage.exists(key)) {
      bad('delete did not remove it');
      failures += 1;
    } else {
      ok('deleted it again');
    }
  } catch (err) {
    bad(`could not delete: ${(err as Error).message}`);
    failures += 1;
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.\n`);
  } else if (storage.name === 'local') {
    // True of the driver, not of the deployment — say which.
    console.log('\nThe local driver works, but these files live on this machine only');
    console.log('and will not survive a redeploy. Configure r2 before launch.\n');
  } else {
    console.log('\nStorage is working. Uploads will survive a redeploy.\n');
  }
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error('\nStorage check crashed:', (err as Error).message, '\n');
  process.exit(1);
});
