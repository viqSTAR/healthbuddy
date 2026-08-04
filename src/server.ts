import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { assertDistributedStore, cacheStore, getRedisClient } from './config/redis.js';

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
};

start().catch((err) => {
  logger.error(`Failed to start: ${err.message}`, err.stack ?? '');
  process.exit(1);
});
