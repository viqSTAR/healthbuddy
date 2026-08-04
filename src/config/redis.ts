import { Redis } from 'ioredis';
import { env, isProduction } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient: Redis | null = null;

/**
 * Process-local fallback so local dev works without Redis running.
 * It is NOT a substitute for Redis: state is per-process, so OTPs and rate
 * limits break across replicas. `assertDistributedStore` refuses to let a
 * production process serve traffic while degraded to this.
 */
const memoryStore = new Map<string, { value: string; expiresAt?: number }>();
let warnedAboutFallback = false;

export const getRedisClient = (): Redis | null => {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      tls: env.REDIS_TLS === 'true' ? { servername: env.REDIS_HOST } : undefined,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      retryStrategy(times: number) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
    });

    redisClient.on('error', (err: Error) => {
      logger.warn(`[Redis] ${err.message}`);
    });
    redisClient.on('ready', () => {
      logger.info('[Redis] Connected.');
    });

    return redisClient;
  } catch (err: any) {
    logger.error(`[Redis] Client construction failed: ${err.message}`);
    return null;
  }
};

const liveClient = (): Redis | null => {
  const client = getRedisClient();
  if (client && client.status === 'ready') return client;

  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    logger.warn(
      '[Redis] UNAVAILABLE — falling back to a process-local store. ' +
        'OTPs, rate limits and slot locks will NOT work across multiple instances.'
    );
  }
  return null;
};

/** Throws if a production process is running without a real distributed store. */
export const assertDistributedStore = (): void => {
  const client = getRedisClient();
  if (isProduction && (!client || client.status !== 'ready')) {
    throw new Error(
      'Redis is unavailable. Refusing to serve production traffic on the ' +
        'process-local fallback store (OTP and rate-limit state would not be shared).'
    );
  }
};

const readMemory = (key: string): string | null => {
  const item = memoryStore.get(key);
  if (!item) return null;
  if (item.expiresAt && Date.now() > item.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return item.value;
};

export const cacheStore = {
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = liveClient();
    if (client) {
      if (ttlSeconds) await client.set(key, value, 'EX', ttlSeconds);
      else await client.set(key, value);
      return;
    }
    memoryStore.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  },

  /**
   * Atomic "set if not exists" — the primitive the old booking code was missing.
   * Returns true only for the caller that actually acquired the key.
   */
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const client = liveClient();
    if (client) {
      const res = await client.set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    }
    // Single-threaded event loop makes this check-and-set atomic in-process.
    if (readMemory(key) !== null) return false;
    memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  },

  async get(key: string): Promise<string | null> {
    const client = liveClient();
    if (client) return client.get(key);
    return readMemory(key);
  },

  async del(key: string): Promise<void> {
    const client = liveClient();
    if (client) {
      await client.del(key);
      return;
    }
    memoryStore.delete(key);
  },

  /** Releases a lock only if this caller still owns it (guards against TTL expiry). */
  async releaseIfOwner(key: string, owner: string): Promise<void> {
    const client = liveClient();
    if (client) {
      await client.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        owner
      );
      return;
    }
    if (readMemory(key) === owner) memoryStore.delete(key);
  },

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const client = liveClient();
    if (client) {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      return count;
    }
    const existing = readMemory(key);
    const count = existing ? parseInt(existing, 10) + 1 : 1;
    const expiresAt = existing
      ? memoryStore.get(key)!.expiresAt
      : Date.now() + ttlSeconds * 1000;
    memoryStore.set(key, { value: String(count), expiresAt });
    return count;
  },

  async disconnect(): Promise<void> {
    if (redisClient) {
      redisClient.disconnect();
      redisClient = null;
    }
    memoryStore.clear();
  },
};
