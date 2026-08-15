import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { isProduction } from './env.js';

/**
 * Money leaves this server as a number, not a string.
 *
 * Money columns are `Decimal`, and Prisma's Decimal serialises itself to a
 * *string* — so the moment the columns changed type, every price in every
 * response quietly became `"112"` instead of `112`. Nothing failed loudly: the
 * apps' `rupees()` helper checks `typeof === 'number'`, falls back to zero, and
 * renders a catalogue where everything costs ₹0.00.
 *
 * Converting in each service only covers the reads someone remembered to
 * convert; TypeScript cannot help, because a Prisma row typed with Decimal is
 * exactly what those endpoints are declared to return. Doing it here means no
 * endpoint can leak one, including ones written later.
 *
 * Safe on the value: two decimal places of rupees is far inside what a double
 * holds exactly. The precision that matters is in storage and in arithmetic,
 * and both stay in Decimal.
 */
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (
  this: Prisma.Decimal
) {
  return this.toNumber();
};

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
/**
 * Verifies the database is reachable at boot.
 *
 * Retries first: serverless Postgres suspends its compute when idle, so a cold
 * start is a normal condition rather than a fault, and giving up on the first
 * attempt means a deploy after a quiet night fails for no reason. Still fails
 * loudly once the attempts run out — this previously swallowed the error and
 * logged a "notice", so the process started healthy-looking and every request
 * failed later.
 */
export const connectDatabase = async (): Promise<void> => {
  const delays = [500, 1500, 3000, 5000];

  for (let attempt = 0; ; attempt += 1) {
    try {
      await basePrisma.$connect();
      // A connection can be handed over before the compute is truly serving, so
      // prove it with a real query.
      await basePrisma.$queryRaw`SELECT 1`;
      logger.info('PostgreSQL connected.');
      return;
    } catch (err: any) {
      if (attempt >= delays.length) {
        logger.error(`PostgreSQL connection failed: ${err.message}`);
        throw err;
      }
      logger.warn(
        `PostgreSQL not reachable yet (attempt ${attempt + 1}/${delays.length + 1}) — the compute may be waking up.`
      );
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]!));
    }
  }
};

export const disconnectDatabase = () => basePrisma.$disconnect();
