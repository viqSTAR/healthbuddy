import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { assertDistributedStore, cacheStore, getRedisClient } from './config/redis.js';
import { errorReporter } from './utils/errorReporter.js';

const start = async () => {
  // Fail fast on a dead database instead of surfacing it as 500s per request.
  await connectDatabase();

  getRedisClient();
  // Give ioredis a moment to establish before asserting on its state.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assertDistributedStore();

  const server = app.listen(env.PORT, () => {
    logger.info(`Health Buddy backend listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down.`);
    server.close(async () => {
      await Promise.allSettled([disconnectDatabase(), cacheStore.disconnect()]);
      process.exit(0);
    });
    // Don't hang forever on lingering keep-alive connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  /**
   * Faults that escaped every handler.
   *
   * Without these Node prints to stderr and, for an unhandled rejection, exits
   * with a code and no context — which in a container is a restart with nothing
   * to explain it. Logging first means the reason survives; exiting after is
   * deliberate, because a process that reached here has state nobody reasoned
   * about and serving the next request from it is a guess.
   */
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection — exiting.', reason);
    errorReporter.capture(reason, { route: 'process/unhandledRejection' });
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception — exiting: ${err.message}`, err.stack ?? '');
    errorReporter.capture(err, { route: 'process/uncaughtException' });
    void shutdown('uncaughtException');
  });
};

start().catch((err) => {
  logger.error(`Failed to start: ${err.message}`, err.stack ?? '');
  process.exit(1);
});
