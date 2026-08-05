import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { isProduction } from './env.js';

const basePrisma = new PrismaClient({
  log: ['warn', 'error'],
  transactionOptions: {
    // The 5s default is too tight against a managed/remote Postgres, where a
    // single round trip can approach a second under load.
    timeout: 20_000,
    maxWait: 10_000,
  },
});

/**
 * Errors that mean "the connection was not usable", as opposed to "the query
 * ran and failed".
 *
 * The distinction is the whole safety argument for retrying: these are raised
 * while establishing or reclaiming a connection, before the statement reaches
 * the server, so re-running cannot duplicate a write. Anything that got as far
 * as executing is left alone.
 *
 *   P1001 — cannot reach the database
 *   P1002 — reached it, timed out
 *   P1017 — server closed the connection
 */
const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1017']);

const isTransient = (err: unknown): boolean => {
  const code = (err as { code?: string }).code;
  if (code && TRANSIENT_CODES.has(code)) return true;

  // Serverless Postgres drops idle connections when the compute suspends. The
  // driver surfaces that as a socket reset with no Prisma error code.
  const message = (err as Error)?.message ?? '';
  return (
    /ECONNRESET|forcibly closed|Connection reset|connection closed|terminating connection/i.test(
      message
    ) && !/unique constraint|foreign key/i.test(message)
  );
};

const RETRY_DELAYS_MS = [150, 600, 1500];

/**
 * Retries a query once the connection drops.
 *
 * Serverless Postgres suspends its compute after a few minutes of inactivity;
 * the first query afterwards has to wait for it to wake. Without this, whoever
 * happens to make that request just gets a 500 — most visibly the first person
 * to open the app after a quiet spell.
 *
 * Deliberately NOT applied to `$transaction`: an interactive transaction that
 * lost its connection has already been rolled back, and replaying it from
 * inside would re-run only part of the work.
 */
export const prisma = basePrisma.$extends({
  query: {
    async $allOperations({ operation, model, args, query }) {
      let lastError: unknown;

      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          return await query(args);
        } catch (err) {
          lastError = err;
          if (!isTransient(err) || attempt === RETRY_DELAYS_MS.length) break;

          const delay = RETRY_DELAYS_MS[attempt]!;
          logger.warn(
            `[db] connection lost on ${model ?? 'raw'}.${operation} — retrying in ${delay}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw lastError;
    },
  },
}) as unknown as PrismaClient;

/**
 * Verifies the database is reachable at boot. This previously swallowed the
 * failure and logged a "notice", so the process started healthy-looking and
 * every request failed later.
 */
export const connectDatabase = async (): Promise<void> => {
  try {
    await basePrisma.$connect();
    logger.info('PostgreSQL connected.');
  } catch (err: any) {
    logger.error(`PostgreSQL connection failed: ${err.message}`);
    throw err;
  }
};

export const disconnectDatabase = () => basePrisma.$disconnect();
