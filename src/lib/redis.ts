// Creates and exports the environment-independent Redis connection.
// Supports Cloud Upstash Redis (REST), Local Docker Redis (TCP socket via ioredis with automatic recovery),
// and an in-memory FallbackCache with selective state migration when Redis becomes available.
import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";

const isDev = process.env["NODE_ENV"] !== "production";
const upstashUrl = process.env["UPSTASH_REDIS_REST_URL"];
const upstashToken = process.env["UPSTASH_REDIS_REST_TOKEN"];
const redisUrl = process.env["REDIS_URL"];

// 1. Production Upstash HTTP Client (Stateless REST)
const upstashClient = upstashUrl && upstashToken ? new UpstashRedis({ url: upstashUrl, token: upstashToken }) : null;

// logging upstash connection
if (upstashClient) {
  void upstashClient
    .ping()
    .then(() => {
      console.log("Connected to Upstash Redis (REST)");
    })
    .catch((error) => {
      console.error("Failed to connect to Upstash Redis:", error.message);
    });
}

// Helper to log development-only structured state snapshots of FallbackCache
function logFallbackEvent(
  action: "GET" | "SET" | "DEL" | "EXPIRE" | "INCR",
  key: string,
  meta: Record<string, any>,
  store: Map<string, { value: string; expiresAt?: number }>
) {
  if (!isDev) return;

  const now = Date.now();
  const entriesSummary: Record<string, { preview: string; ttl: string }> = {};

  for (const [k, item] of store.entries()) {
    let preview = item.value;
    if (k.startsWith("session:")) {
      try {
        const parsed = JSON.parse(item.value);
        preview = `[Session: userId=${parsed.userId}]`;
      } catch {
        preview = "[Session]";
      }
    } else if (preview.length > 50) {
      preview = preview.slice(0, 47) + "...";
    }

    const ttl = item.expiresAt
      ? `${Math.max(0, Math.ceil((item.expiresAt - now) / 1000))}s`
      : "permanent";

    entriesSummary[k] = { preview, ttl };
  }

  console.log(`\n\x1b[36m[FALLBACK_CACHE:${action}]\x1b[0m \x1b[33m${key}\x1b[0m`, meta);
  console.log(`\x1b[90m📦 Fallback Memory Structure (${store.size} items in Map):\x1b[0m`, entriesSummary, "\n");
}

// 2. In-Memory fallback cache when Redis is offline or recovering
class FallbackCache {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) {
      logFallbackEvent("GET", key, { hit: false }, this.store);
      return null;
    }
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      logFallbackEvent("GET", key, { hit: false, reason: "EXPIRED_EVICTED" }, this.store);
      return null;
    }
    logFallbackEvent("GET", key, { hit: true }, this.store);
    return item.value;
  }

  async set(key: string, value: string, opts?: { ex?: number }): Promise<"OK"> {
    const expiresAt = opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : undefined;
    if (expiresAt !== undefined) {
      this.store.set(key, { value, expiresAt });
    } else {
      this.store.set(key, { value });
    }
    logFallbackEvent("SET", key, { ttlSeconds: opts?.ex ?? null }, this.store);
    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.store.delete(key);
    logFallbackEvent("DEL", key, { deleted: existed }, this.store);
    return existed ? 1 : 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const item = this.store.get(key);
    if (!item) {
      logFallbackEvent("EXPIRE", key, { success: false, reason: "NOT_FOUND" }, this.store);
      return false;
    }
    item.expiresAt = Date.now() + ttlSeconds * 1000;
    logFallbackEvent("EXPIRE", key, { success: true, ttlSeconds }, this.store);
    return true;
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    if (!item.expiresAt) return -1;
    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  async incr(key: string): Promise<number> {
    const currentStr = await this.get(key);
    const count = currentStr ? parseInt(currentStr, 10) + 1 : 1;
    await this.set(key, String(count));
    logFallbackEvent("INCR", key, { newCount: count }, this.store);
    return count;
  }

  /**
   * Retrieves active, unexpired session entries with their remaining TTL in seconds.
   * Temporary ratelimit counters and ordinary slug caches are excluded from automatic migration.
   */
  getActiveSessions(): Array<{ key: string; value: string; remainingTtl: number }> {
    const now = Date.now();
    const sessions: Array<{ key: string; value: string; remainingTtl: number }> = [];

    for (const [key, item] of this.store.entries()) {
      if (key.startsWith("session:")) {
        if (item.expiresAt) {
          const remainingMs = item.expiresAt - now;
          if (remainingMs > 0) {
            sessions.push({
              key,
              value: item.value,
              remainingTtl: Math.max(1, Math.ceil(remainingMs / 1000)),
            });
          } else {
            this.store.delete(key);
          }
        } else {
          // Default session expiration (30 days) if none set
          sessions.push({
            key,
            value: item.value,
            remainingTtl: 30 * 24 * 60 * 60,
          });
        }
      }
    }
    return sessions;
  }

  delete(key: string): boolean {
    const deleted = this.store.delete(key);
    if (deleted) {
      logFallbackEvent("DEL", key, { reason: "PROMOTED_TO_REDIS" }, this.store);
    }
    return deleted;
  }
}

const fallbackCache = new FallbackCache();

// 3. Selective State Migration: Promote active sessions from fallback memory to Redis
let isMigrating = false;

export async function migrateFallbackSessions(): Promise<void> {
  if (isMigrating) return;
  isMigrating = true;

  try {
    const sessions = fallbackCache.getActiveSessions();
    if (sessions.length === 0) return;

    console.log(`\x1b[36m[REDIS:RECOVERY]\x1b[0m Migrating ${sessions.length} active session(s) from fallback memory to Redis...`);

    for (const session of sessions) {
      try {
        if (upstashClient) {
          await upstashClient.set(session.key, session.value, { ex: session.remainingTtl });
        } else if (tcpClient && tcpClient.status === "ready") {
          await tcpClient.set(session.key, session.value, "EX", session.remainingTtl);
        } else {
          // Redis disconnected during migration; stop loop and retain remaining sessions in memory
          break;
        }
        // Remove promoted session from fallback store to prevent memory leaks or stale reads
        fallbackCache.delete(session.key);
      } catch (err) {
        console.error(`Failed to migrate session ${session.key} to Redis:`, err);
      }
    }
    console.log(`\x1b[32m[REDIS:RECOVERY]\x1b[0m Session migration completed successfully.`);
  } finally {
    isMigrating = false;
  }
}

// 4. Local Docker TCP Redis Client (ioredis) with automatic reconnect & exponential backoff
let hasLoggedOfflineWarning = false;

const tcpClient = !upstashClient && redisUrl
  ? new IORedis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // Prevents queuing/hanging requests when offline; immediately falls back to in-memory cache
      retryStrategy: (times) => {
        // Exponential backoff: min 500ms, max 5000ms
        const delay = Math.min(times * 500, 5000);
        return delay;
      },
    })
  : null;

if (tcpClient) {
  tcpClient.on("ready", () => {
    hasLoggedOfflineWarning = false;
    console.log(`\n\x1b[32m✔ Redis Connected & Ready\x1b[0m (${redisUrl})`);
    void migrateFallbackSessions();
  });

  tcpClient.on("close", () => {
    // Socket disconnected
  });

  tcpClient.on("error", (err: { code?: string; message?: string }) => {
    if (!hasLoggedOfflineWarning) {
      hasLoggedOfflineWarning = true;
      console.log("\n--------------------------------------------------");
      console.log(`\x1b[33m⚠️  Redis Connection Unavailable\x1b[0m`);
      console.log(`Target: \x1b[33m${redisUrl}\x1b[0m`);
      console.log(`Status: Connection refused (${err.code || err.message || "ECONNREFUSED"})`);
      console.log(`ℹ️  Operating in in-memory fallback mode. Automatic reconnection active in background.`);
      console.log("--------------------------------------------------\n");
    }
  });

  // Initial connection attempt (errors are handled gracefully by the 'error' event listener)
  tcpClient.connect().catch(() => {});
}

// 5. Unified Cache API with zero-overhead socket status checks and session promotion
export const cache = {
  async get(key: string): Promise<string | null> {
    let result: string | null = null;
    let redisQueriedSuccessfully = false;

    if (upstashClient) {
      try {
        result = await upstashClient.get<string>(key);
        redisQueriedSuccessfully = true;
      } catch {
        result = await fallbackCache.get(key);
      }
    } else if (tcpClient && tcpClient.status === "ready") {
      try {
        result = await tcpClient.get(key);
        redisQueriedSuccessfully = true;
      } catch {
        result = await fallbackCache.get(key);
      }
    } else {
      result = await fallbackCache.get(key);
    }

    // Stateful promotion: If Redis returned null for a session created during downtime, promote it
    if (redisQueriedSuccessfully && result === null && key.startsWith("session:")) {
      const fallbackItem = await fallbackCache.get(key);
      if (fallbackItem) {
        result = fallbackItem;
        const ttl = await fallbackCache.ttl(key);
        const remainingTtl = ttl > 0 ? ttl : 30 * 24 * 60 * 60;
        try {
          if (upstashClient) {
            await upstashClient.set(key, fallbackItem, { ex: remainingTtl });
          } else if (tcpClient && tcpClient.status === "ready") {
            await tcpClient.set(key, fallbackItem, "EX", remainingTtl);
          }
          fallbackCache.delete(key);
        } catch {}
      }
    }

    return result;
  },

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (upstashClient) {
      try {
        if (ttlSeconds) {
          await upstashClient.set(key, value, { ex: ttlSeconds });
        } else {
          await upstashClient.set(key, value);
        }
        return;
      } catch {
        // Fallback below
      }
    } else if (tcpClient && tcpClient.status === "ready") {
      try {
        if (ttlSeconds) {
          await tcpClient.set(key, value, "EX", ttlSeconds);
        } else {
          await tcpClient.set(key, value);
        }
        return;
      } catch {
        // Fallback below
      }
    }
    await fallbackCache.set(key, value, ttlSeconds ? { ex: ttlSeconds } : undefined);
  },

  async del(key: string): Promise<void> {
    if (upstashClient) {
      try {
        await upstashClient.del(key);
      } catch {
        // Fallback below
      }
    } else if (tcpClient && tcpClient.status === "ready") {
      try {
        await tcpClient.del(key);
      } catch {
        // Fallback below
      }
    }
    // Delete from in-memory fallback cache as well
    await fallbackCache.del(key);
  },

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (upstashClient) {
      try {
        await upstashClient.expire(key, ttlSeconds);
        return;
      } catch {
        // Fallback below
      }
    } else if (tcpClient && tcpClient.status === "ready") {
      try {
        await tcpClient.expire(key, ttlSeconds);
        return;
      } catch {
        // Fallback below
      }
    }
    await fallbackCache.expire(key, ttlSeconds);
  },

  async ttl(key: string): Promise<number> {
    if (upstashClient) {
      try {
        return await upstashClient.ttl(key);
      } catch {
        // Fallback below
      }
    } else if (tcpClient && tcpClient.status === "ready") {
      try {
        return await tcpClient.ttl(key);
      } catch {
        // Fallback below
      }
    }
    return await fallbackCache.ttl(key);
  },

  async incr(key: string): Promise<number> {
    let count = 0;
    if (upstashClient) {
      try {
        count = await upstashClient.incr(key);
        return count;
      } catch {
        count = await fallbackCache.incr(key);
      }
    } else if (tcpClient && tcpClient.status === "ready") {
      try {
        count = await tcpClient.incr(key);
        return count;
      } catch {
        count = await fallbackCache.incr(key);
      }
    } else {
      count = await fallbackCache.incr(key);
    }
    return count;
  },
};
