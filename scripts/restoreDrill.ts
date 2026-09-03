/**
 * Proves a backup can actually be restored.
 *
 *   npm run restore:drill
 *   npm run restore:drill -- --dump ./backups/nightly.sql
 *
 * An untested backup is a hope, not a backup. The failure everyone eventually
 * meets is not "there was no backup" — it is "there was a backup and it did not
 * restore", discovered on the worst day, by someone who cannot fix it then.
 *
 * With no arguments this takes a fresh dump of the configured database, restores
 * it into a scratch database, and compares row counts across every table that
 * matters. With `--dump` it restores a file you already have, which is the more
 * useful drill: it tests the backup you are actually keeping.
 *
 * Never writes to the source database. The scratch database is dropped at the
 * end whether the drill passed or failed.
 *
 * Requires `pg_dump` and `psql` on PATH — they ship with PostgreSQL.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const run = promisify(execFile);

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/**
 * Query parameters Prisma understands and libpq does not.
 *
 * `DATABASE_URL` is a Prisma connection string, and handing it straight to
 * pg_dump fails with `invalid URI query parameter: "schema"` — the tools share
 * a URL format but not a vocabulary. Dropping the Prisma-only keys leaves a URL
 * both accept, while keeping `sslmode` and friends, which a managed database
 * genuinely needs.
 */
const PRISMA_ONLY_PARAMS = [
  'schema',
  'connection_limit',
  'pool_timeout',
  'pgbouncer',
  'socket_timeout',
  'sslidentity',
  'sslpassword',
  'statement_cache_size',
];

const toLibpqUrl = (url: URL): string => {
  const clean = new URL(url.toString());
  for (const key of PRISMA_ONLY_PARAMS) clean.searchParams.delete(key);
  return clean.toString();
};

/**
 * A connection string with the password taken out.
 *
 * Everything here can end up in a terminal, a CI log or a pasted bug report,
 * and the first run of this script printed the live database password into an
 * error message. Nothing may render a URL except through this.
 */
const redact = (text: string): string =>
  text.replace(/(postgres(?:ql)?:\/\/[^:@\s]+:)[^@\s]+(@)/gi, '$1***$2');

/** Tables whose contents losing would be a real incident. */
const CRITICAL_TABLES = [
  'User',
  'Patient',
  'Doctor',
  'Pharmacy',
  'LabPartner',
  'Appointment',
  'Prescription',
  'MedicineOrder',
  'LabOrder',
  'Payment',
  'PaymentSplit',
  'ConsentRecord',
  'AuditLog',
  'Document',
] as const;

const countRows = async (url: string): Promise<Record<string, number>> => {
  const client = new PrismaClient({ datasources: { db: { url } } });
  const counts: Record<string, number> = {};
  try {
    for (const table of CRITICAL_TABLES) {
      const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}"`
      );
      counts[table] = Number(rows[0]?.count ?? 0);
    }
  } finally {
    await client.$disconnect();
  }
  return counts;
};

const main = async () => {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const scratchName = `healthbuddy_restore_drill_${Date.now()}`;
  const adminUrl = new URL(sourceUrl);
  const sourceDb = adminUrl.pathname.replace(/^\//, '').split('?')[0]!;
  adminUrl.pathname = '/postgres';

  const scratchUrl = new URL(sourceUrl);
  scratchUrl.pathname = `/${scratchName}`;

  /**
   * Check the tools before doing anything else.
   *
   * `spawn pg_dump ENOENT` a few lines into a drill tells you nothing useful if
   * you do not already know what pg_dump is — and the person running a restore
   * drill for the first time is exactly the person who does not.
   */
  for (const binary of ['pg_dump', 'psql']) {
    const found = await run(binary, ['--version']).then(
      () => true,
      () => false
    );
    if (!found) {
      console.error(
        [
          '',
          `  ${binary} is not on PATH.`,
          '',
          '  The drill shells out to the PostgreSQL client tools. They ship with a',
          '  PostgreSQL installation but are not always added to PATH — and are not',
          '  installed at all when the server runs in Docker or as a managed service.',
          '',
          '    Windows:  add C:\\Program Files\\PostgreSQL\\<version>\\bin to PATH',
          '    macOS:    brew install libpq && brew link --force libpq',
          '    Debian:   apt install postgresql-client',
          '    Docker:   docker run --rm postgres:16 pg_dump ...',
          '',
          '  The client version must be >= the server, or pg_dump refuses to run.',
          '',
        ].join('\n')
      );
      process.exitCode = 1;
      return;
    }
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'hb-restore-'));
  const dumpPath = arg('dump') ?? path.join(workDir, 'drill.sql');
  const usingExisting = Boolean(arg('dump'));

  console.log(`\nRestore drill\n`);
  console.log(`  source:  ${sourceDb}`);
  console.log(`  scratch: ${scratchName}`);
  console.log(`  dump:    ${dumpPath}${usingExisting ? ' (existing)' : ' (taken now)'}\n`);

  let restored = false;

  try {
    if (!usingExisting) {
      console.log('  Taking a dump...');
      await run('pg_dump', [
        '--no-owner',
        '--no-acl',
        '--format=plain',
        '--file',
        dumpPath,
        toLibpqUrl(new URL(sourceUrl)),
      ]);
      const { size } = await stat(dumpPath);
      console.log(`    ${(size / 1024).toFixed(0)} KB\n`);
    } else {
      const { size } = await stat(dumpPath);
      console.log(`    ${(size / 1024).toFixed(0)} KB\n`);
    }

    console.log('  Restoring into a scratch database...');
    await run('psql', [
      toLibpqUrl(adminUrl),
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `CREATE DATABASE "${scratchName}"`,
    ]);
    restored = true;
    await run('psql', [toLibpqUrl(scratchUrl), '-v', 'ON_ERROR_STOP=1', '-q', '-f', dumpPath]);
    console.log('    restored\n');

    console.log('  Comparing row counts...\n');
    const [before, after] = await Promise.all([countRows(sourceUrl), countRows(scratchUrl.toString())]);

    let mismatches = 0;
    for (const table of CRITICAL_TABLES) {
      const a = before[table] ?? 0;
      const b = after[table] ?? 0;
      const same = a === b;
      if (!same) mismatches += 1;
      console.log(
        `    ${same ? '✓' : '✗'} ${table.padEnd(18)} source ${String(a).padStart(7)}   restored ${String(b).padStart(7)}`
      );
    }

    console.log('');
    if (mismatches) {
      console.log(`  DRILL FAILED — ${mismatches} table(s) did not match.`);
      console.log('  A backup that restores incomplete data is worse than none, because');
      console.log('  it will be trusted. Investigate before relying on this backup.\n');
      process.exitCode = 1;
    } else {
      console.log('  Drill passed. Every critical table restored with matching row counts.\n');
      console.log('  Note: this proves the dump/restore path works. It does NOT prove your');
      console.log('  scheduled backups are running, retained, or stored off-host — check those');
      console.log('  separately, and re-run this against a real nightly dump with --dump.\n');
    }
  } catch (err) {
    // Redacted: the client tools echo the whole connection string on failure,
    // password included, and this output lands in terminals and CI logs.
    console.error(`\n  Drill failed: ${redact((err as Error).message)}\n`);
    process.exitCode = 1;
  } finally {
    if (restored) {
      await run('psql', [toLibpqUrl(adminUrl), '-c', `DROP DATABASE IF EXISTS "${scratchName}"`]).catch(
        () => console.error(`  Could not drop ${scratchName} — remove it by hand.`)
      );
    }
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

void main();
