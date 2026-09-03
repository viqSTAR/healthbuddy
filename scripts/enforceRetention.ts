/**
 * The retention sweep, for a scheduler.
 *
 *   npm run retention          # report only — what would be removed
 *   npm run retention -- --apply
 *
 * Meant for a nightly cron or a platform scheduled job. Exits non-zero on
 * failure so a scheduler notices; prints the report either way so the run has
 * something in its log beyond "ok".
 *
 * `--apply` is required to delete anything. A retention job that deletes by
 * default is one accidental invocation away from a bad afternoon, and the usual
 * reason to run it by hand is to see what it would do.
 */
import { enforceRetentionService } from '../src/services/retentionService.js';
import { disconnectDatabase } from '../src/config/db.js';
import { cacheStore } from '../src/config/redis.js';

const main = async () => {
  const apply = process.argv.includes('--apply');

  const report = await enforceRetentionService({ dryRun: !apply });

  console.log(`\nRetention sweep — ${report.ranAt}${report.dryRun ? '  (dry run)' : ''}\n`);

  console.log('  Removed under short retention:');
  for (const [what, count] of Object.entries(report.swept)) {
    console.log(`    ${what.padEnd(26)} ${count}`);
  }

  console.log('\n  Past their statutory floor — NOT deleted, for review:');
  for (const [what, count] of Object.entries(report.awaitingReview)) {
    console.log(`    ${what.padEnd(26)} ${count}`);
  }

  console.log(`\n  ${report.note}\n`);

  if (report.dryRun) {
    console.log('  Re-run with --apply to delete.\n');
  }
};

main()
  .catch((err: unknown) => {
    console.error('Retention sweep failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([disconnectDatabase(), cacheStore.disconnect()]);
  });
