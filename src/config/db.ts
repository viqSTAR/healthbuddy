import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { isProduction } from './env.js';

export const prisma = new PrismaClient({
  log: ['warn', 'error'],
  transactionOptions: {
    // The 5s default is too tight against a managed/remote Postgres, where a
    // single round trip can approach a second under load.
    timeout: 20_000,
    maxWait: 10_000,
  },
});

/**
 * Verifies the database is reachable at boot. This previously swallowed the
 * failure and logged a "notice", so the process started healthy-looking and
 * every request failed later.
 */
export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected.');
  } catch (err: any) {
    logger.error(`PostgreSQL connection failed: ${err.message}`);
    throw err;
  }
};

export const disconnectDatabase = () => prisma.$disconnect();
