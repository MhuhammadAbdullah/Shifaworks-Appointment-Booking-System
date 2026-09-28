import { Redis, type RedisOptions } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

let client: Redis | null = null;
let lastErrorLogAt = 0;

function logThrottled(err: Error): void {
  // A missing Redis emits an error on every reconnect attempt; log at most
  // once every 30 s so the log is not flooded.
  const now = Date.now();
  if (now - lastErrorLogAt > 30_000) {
    lastErrorLogAt = now;
    const code = (err as { code?: string }).code;
    logger.error({ redis: { code, message: err.message || code } }, "redis connection error (retrying)");
  }
}

/**
 * Shared Redis connection for ordinary commands (cache, rate limits, locks),
 * or null when Redis is not configured. Commands fail fast while Redis is
 * unreachable instead of queueing forever. Every caller must degrade
 * gracefully: correctness (double booking, capacity) is guaranteed by
 * PostgreSQL; Redis only adds queues and caching.
 */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
    });
    client.on("error", logThrottled);
  }
  return client;
}

/**
 * New dedicated connection for BullMQ queues/workers. BullMQ requires
 * maxRetriesPerRequest=null because workers use blocking commands, so these
 * connections must never be used for request-path commands.
 */
export function createQueueConnection(overrides: RedisOptions = {}): Redis {
  if (!env.REDIS_URL) throw new Error("REDIS_URL is not configured");
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, ...overrides });
  conn.on("error", logThrottled);
  return conn;
}

/** PING with a hard timeout; never hangs a request. */
export async function pingRedis(timeoutMs = 1_500): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redis ping timeout")), timeoutMs);
      }),
    ]);
    return result === "PONG";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    client.disconnect();
    client = null;
  }
}
