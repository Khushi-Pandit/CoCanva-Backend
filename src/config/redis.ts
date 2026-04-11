import { env } from './env';
import { logger } from '../utils/logger';
import Redis from 'ioredis';

let pubClient: Redis;
let subClient: Redis;
let cacheClient: Redis;

export function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  client.on('error', (err) => {
    logger.error('Redis client error', { error: err.message });
  });

  client.on('connect', () => {
    logger.info('Redis connected');
  });

  client.on('reconnecting', () => {
    logger.warn('Redis reconnecting…');
  });

  return client;
}

export async function connectRedis(): Promise<void> {
  pubClient = createRedisClient();
  subClient = createRedisClient();
  cacheClient = createRedisClient();

  await Promise.all([
    pubClient.connect(),
    subClient.connect(),
    cacheClient.connect(),
  ]);

  logger.info('Redis: pub/sub/cache clients connected');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    pubClient?.quit(),
    subClient?.quit(),
    cacheClient?.quit(),
  ]);
  logger.info('Redis connections closed');
}

export function getPubClient(): Redis { return pubClient; }
export function getSubClient(): Redis { return subClient; }
export function getCacheClient(): Redis { return cacheClient; }

// ── Cache helpers ─────────────────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await cacheClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await cacheClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch { /* swallow */ }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await cacheClient.del(key);
  } catch { /* swallow */ }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const keys = await cacheClient.keys(pattern);
    if (keys.length > 0) await cacheClient.del(...keys);
  } catch { /* swallow */ }
}

// TTL constants (seconds)
export const CACHE_TTL = {
  CANVAS_ELEMENTS: 15 * 60,   // 15 min
  CANVAS_META: 5 * 60,        // 5 min
  USER_PROFILE: 30 * 60,      // 30 min
  SHARE_TOKEN: 24 * 60 * 60,  // 24 h
  AI_RESPONSE: 60 * 60,       // 1 h
} as const;
