// Creates and exports the environment-independent Redis connection.
// Supports Cloud Upstash Redis (REST), Local Docker Redis (TCP socket via ioredis with automatic recovery),
// and an in-memory FallbackCache with selective state migration when Redis becomes available.

import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";
import { maskToken, providerTag, type CacheProvider } from "./logger";

export type { CacheProvider };
export type RedisProvider = Exclude<CacheProvider, "FALLBACK">;

/** Result of a cache operation, including which provider actually served it. */
export type CacheResult<T> = {
  value: T;
  /** The provider that actually handled the operation ("FALLBACK" = in-memory). */
  provider: CacheProvider;
  /** Set when a session read from memory was also promoted into this Redis provider. */
  promotedTo?: RedisProvider;
};

const SESSION_KEY_PREFIX = "session:";
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days (matches SESSION_TTL_SECONDS in auth.ts)

// --------------------------------------------------------------------------
// Minimal structural views of the two clients (also what tests inject).
// --------------------------------------------------------------------------
export interface UpstashLike {
  ping(): Promise<unknown>;
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
}

export interface TcpLike {
  status: string;
  on(event: string, listener: (...args: any[]) => void): unknown;
  connect(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
}

export interface CacheOptions {
  upstash: UpstashLike | null;
  tcp: TcpLike | null;
  /** Credential-free description of the local Redis target, for logs. */
  tcpTarget?: string;
  isDev: boolean;
  /** Secret strings that must never appear in logs (redacted if they leak through error messages). */
  secrets?: Array<string | undefined>;
  /** Log sink (defaults to console). */
  out?: Pick<Console, "log" | "warn" | "error">;
}

// --------------------------------------------------------------------------
// Log-safety helpers
// --------------------------------------------------------------------------
/** Masks the token part of session keys so full session tokens never reach logs. */
function maskKey(key: string): string {
  return key.startsWith(SESSION_KEY_PREFIX) ? SESSION_KEY_PREFIX + maskToken(key.slice(SESSION_KEY_PREFIX.length)) : key;
}

/** Strips credentials from a Redis URL so it is safe to print. */
export function sanitizeRedisUrl(url?: string): string {
  if (!url) return "<REDIS_URL not set>";
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== "/" ? u.pathname : "";
    return `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}${path}`;
  } catch {
    return "<invalid REDIS_URL>";
  }
}

type FallbackAction = "GET" | "SET" | "DEL" | "EXPIRE" | "INCR";
type StoreEntry = { value: string; expiresAt?: number };
type RedisOp = "GET" | "SET" | "DEL" | "EXPIRE" | "TTL" | "INCR";

// --------------------------------------------------------------------------
// In-memory fallback cache used when Redis is offline or recovering
// --------------------------------------------------------------------------
class FallbackCache {
  private store = new Map<string, StoreEntry>();

  constructor(
    private readonly emit: (action: FallbackAction, key: string, meta: Record<string, unknown>, store: Map<string, StoreEntry>) => void
  ) {}

  get size(): number {
    return this.store.size;
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) {
      this.emit("GET", key, { hit: false }, this.store);
      return null;
    }
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      this.emit("GET", key, { hit: false, reason: "EXPIRED_EVICTED" }, this.store);
      return null;
    }
    this.emit("GET", key, { hit: true }, this.store);
    return item.value;
  }

  /** Silent read (no logging, no side effects other than evicting an expired entry). */
  peek(key: string): string | null {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, opts?: { ex?: number }): Promise<"OK"> {
    const expiresAt = opts?.ex !== undefined ? Date.now() + opts.ex * 1000 : undefined;
    if (expiresAt !== undefined) {
      this.store.set(key, { value, expiresAt });
    } else {
      this.store.set(key, { value });
    }
    this.emit("SET", key, { ttlSeconds: opts?.ex ?? null }, this.store);
    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.store.delete(key);
    this.emit("DEL", key, { deleted: existed }, this.store);
    return existed ? 1 : 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const item = this.store.get(key);
    if (!item) {
      this.emit("EXPIRE", key, { success: false, reason: "NOT_FOUND" }, this.store);
      return false;
    }
    item.expiresAt = Date.now() + ttlSeconds * 1000;
    this.emit("EXPIRE", key, { success: true, ttlSeconds }, this.store);
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

  /**
   * Like Redis INCR, this preserves an existing TTL. (Previously incr() went through set() without a TTL,
   * which silently stripped the expiry and made rate-limit windows slide forward on every hit.)
   */
  async incr(key: string): Promise<number> {
    const item = this.store.get(key);
    const live = item && !(item.expiresAt && Date.now() > item.expiresAt) ? item : undefined;
    const parsed = live ? parseInt(live.value, 10) : 0;
    const count = (Number.isNaN(parsed) ? 0 : parsed) + 1;
    if (live?.expiresAt !== undefined) {
      this.store.set(key, { value: String(count), expiresAt: live.expiresAt });
    } else {
      this.store.set(key, { value: String(count) });
    }
    this.emit("INCR", key, { newCount: count }, this.store);
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
      if (key.startsWith(SESSION_KEY_PREFIX)) {
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
          sessions.push({ key, value: item.value, remainingTtl: DEFAULT_SESSION_TTL_SECONDS });
        }
      }
    }
    return sessions;
  }

  /** Removes an entry after it has been promoted to Redis (logged). */
  delete(key: string): boolean {
    const deleted = this.store.delete(key);
    if (deleted) {
      this.emit("DEL", key, { reason: "PROMOTED_TO_REDIS" }, this.store);
    }
    return deleted;
  }

  /** Silently drops a stale copy because Redis now holds the authoritative value. */
  discard(key: string): void {
    this.store.delete(key);
  }
}

type PromoteResult =
  | { status: "promoted"; provider: RedisProvider; alreadyPresent: boolean }
  | { status: "unavailable" }
  | { status: "cancelled" };

export function createCache(options: CacheOptions) {
  const { upstash, tcp, isDev } = options;
  const out = options.out ?? console;
  const tcpTarget = options.tcpTarget ?? "local Redis";
  const secrets = (options.secrets ?? []).filter((s): s is string => typeof s === "string" && s.length >= 4);

  // ---- logging (development only) ----------------------------------------
  const redact = (text: string): string => secrets.reduce((acc, s) => acc.split(s).join("***"), text);

  const describeError = (err: unknown): string => {
    const e = err as { code?: unknown; message?: unknown } | null;
    const message = err instanceof Error ? err.message : typeof e?.message === "string" ? e.message : String(err);
    const code = typeof e?.code === "string" ? e.code : undefined;
    const text = code && !message.includes(code) ? `${code}: ${message}` : message;
    return redact(text.length > 300 ? text.slice(0, 297) + "..." : text);
  };

  const emit = (level: "log" | "warn" | "error", provider: CacheProvider, message: string): void => {
    if (!isDev) return;
    out[level](`${providerTag(provider)} ${message}`);
  };

  // Structured snapshot of the in-memory store (development only). Keys are masked: session keys embed the token.
  const logFallbackEvent = (
    action: FallbackAction,
    key: string,
    meta: Record<string, unknown>,
    store: Map<string, StoreEntry>
  ): void => {
    if (!isDev) return;
    const now = Date.now();
    const entriesSummary: Record<string, { preview: string; ttl: string }> = {};

    for (const [k, item] of store.entries()) {
      let preview = item.value;
      if (k.startsWith(SESSION_KEY_PREFIX)) {
        try {
          const parsed = JSON.parse(item.value);
          preview = `[Session: userId=${parsed.userId}]`;
        } catch {
          preview = "[Session]";
        }
      } else if (preview.length > 50) {
        preview = preview.slice(0, 47) + "...";
      }
      const ttl = item.expiresAt ? `${Math.max(0, Math.ceil((item.expiresAt - now) / 1000))}s` : "permanent";
      entriesSummary[maskKey(k)] = { preview, ttl };
    }

    out.log(`\n${providerTag("FALLBACK")} \x1b[36m${action}\x1b[0m \x1b[33m${maskKey(key)}\x1b[0m`, meta);
    out.log(`\x1b[90m📦 Fallback Memory Structure (${store.size} items in Map):\x1b[0m`, entriesSummary, "\n");
  };

  const fallbackCache = new FallbackCache(logFallbackEvent);

  // ---- provider state ------------------------------------------------------
  // Upstash is stateless REST, so "connected" can only be learned from a real response (ping or any command).
  type UpstashState = "unknown" | "up" | "down";
  let upstashState: UpstashState = "unknown";
  let tcpWasReady = false;
  let hasLoggedOfflineWarning = false;
  // Dedupes "fallback activated" logs: true while we are (known to be) serving from memory.
  let fallbackAnnounced = false;

  const activateFallback = (reason: string): void => {
    if (fallbackAnnounced) return;
    fallbackAnnounced = true;
    emit("warn", "FALLBACK", `Fallback activated: ${reason}. Affected operations are served from memory only.`);
  };

  const activeRedisProvider = (): RedisProvider | null => {
    if (upstash) return "UPSTASH";
    if (tcp && tcp.status === "ready") return "LOCAL";
    return null;
  };

  // ---- session migration ---------------------------------------------------
  let migrating = false;
  let migrationRequested = false;

  /**
   * Moves one session from memory into Redis, keeping its remaining TTL.
   * - SET ... NX: never overwrites a value Redis already has (Redis is authoritative once reachable).
   * - Re-checks the in-memory copy before AND after the write so a session that was destroyed (logout) or
   *   replaced while the write was in flight is not resurrected in Redis.
   */
  async function promoteSession(key: string, value: string, ttlSeconds: number): Promise<PromoteResult> {
    if (fallbackCache.peek(key) !== value) return { status: "cancelled" };

    const r = await viaRedis(
      "SET",
      key,
      (c) => c.set(key, value, { ex: ttlSeconds, nx: true }),
      (c) => c.set(key, value, "EX", ttlSeconds, "NX")
    );
    if (!r.ok) return { status: "unavailable" };

    const wrote = r.value === "OK";
    if (fallbackCache.peek(key) !== value) {
      // Destroyed/replaced while the write was in flight: undo what we wrote.
      if (wrote) await viaRedis("DEL", key, (c) => c.del(key), (c) => c.del(key));
      return { status: "cancelled" };
    }
    fallbackCache.delete(key); // remove promoted session so it can't be read stale or leak memory
    return { status: "promoted", provider: r.provider, alreadyPresent: !wrote };
  }

  async function migrateOnce(): Promise<void> {
    const sessions = fallbackCache.getActiveSessions();
    if (sessions.length === 0) return;

    const provider = activeRedisProvider();
    if (!provider) {
      emit("log", "FALLBACK", `${sessions.length} active session(s) remain in memory; no Redis provider is ready yet.`);
      return;
    }

    emit("log", provider, `Session migration started: ${sessions.length} active session(s) from memory.`);

    let migrated = 0;
    let alreadyPresent = 0;
    let cancelled = 0;
    let processed = 0;
    let interrupted = false;

    for (const session of sessions) {
      const result = await promoteSession(session.key, session.value, session.remainingTtl);
      if (result.status === "unavailable") {
        interrupted = true; // provider failure already logged by viaRedis; keep the rest in memory
        break;
      }
      processed++;
      if (result.status === "cancelled") cancelled++;
      else if (result.alreadyPresent) alreadyPresent++;
      else migrated++;
    }

    const remaining = sessions.length - processed;
    const detail = `${migrated} migrated, ${alreadyPresent} already in Redis, ${cancelled} skipped (changed/destroyed during migration)`;
    if (interrupted) {
      emit("warn", provider, `Session migration interrupted: ${detail}; ${remaining} session(s) still in memory (will retry on recovery).`);
    } else {
      emit("log", provider, `Session migration finished: ${detail}.`);
    }
  }

  /**
   * Promotes active sessions from fallback memory to Redis. Safe to call from any trigger (TCP ready,
   * Upstash ping, Upstash recovery): concurrent calls are coalesced; a trigger that arrives mid-run
   * schedules exactly one more pass instead of starting an overlapping one.
   */
  async function migrateFallbackSessions(): Promise<void> {
    if (migrating) {
      migrationRequested = true;
      return;
    }
    migrating = true;
    try {
      do {
        migrationRequested = false;
        await migrateOnce();
      } while (migrationRequested);
    } finally {
      migrating = false;
    }
  }

  // ---- Upstash state transitions -------------------------------------------
  function upstashSucceeded(source: string): void {
    if (upstashState === "up") return;
    const previous = upstashState;
    upstashState = "up";
    fallbackAnnounced = false;
    emit("log", "UPSTASH", previous === "down" ? `Connection restored (confirmed by ${source}).` : `Connected (confirmed by ${source}).`);
    void migrateFallbackSessions();
  }

  function upstashFailed(op: string, key: string | undefined, err: unknown): void {
    emit("error", "UPSTASH", `${op}${key ? ` ${maskKey(key)}` : ""} failed: ${describeError(err)}`);
    if (upstashState !== "down") {
      upstashState = "down";
      activateFallback("Upstash is unreachable or returned an error");
    }
  }

  // ---- single place where a Redis provider is attempted ----------------------
  type RedisAttempt<T> = { ok: true; value: T; provider: RedisProvider } | { ok: false };

  async function viaRedis<T>(
    op: RedisOp,
    key: string,
    upstashFn: (c: UpstashLike) => Promise<T>,
    tcpFn: (c: TcpLike) => Promise<T>
  ): Promise<RedisAttempt<T>> {
    if (upstash) {
      try {
        const value = await upstashFn(upstash);
        upstashSucceeded(op);
        return { ok: true, value, provider: "UPSTASH" };
      } catch (err) {
        upstashFailed(op, key, err);
        return { ok: false };
      }
    }
    if (tcp) {
      if (tcp.status !== "ready") {
        activateFallback(`Local Redis is not ready (status: ${tcp.status})`);
        return { ok: false };
      }
      try {
        const value = await tcpFn(tcp);
        return { ok: true, value, provider: "LOCAL" };
      } catch (err) {
        emit("error", "LOCAL", `${op} ${maskKey(key)} failed: ${describeError(err)}`);
        activateFallback("Local Redis command failed");
        return { ok: false };
      }
    }
    return { ok: false };
  }

  // ---- operations ------------------------------------------------------------
  async function getDetailed(key: string): Promise<CacheResult<string | null>> {
    const r = await viaRedis("GET", key, (c) => c.get<string>(key), (c) => c.get(key));
    if (!r.ok) {
      return { value: await fallbackCache.get(key), provider: "FALLBACK" };
    }
    if (r.value !== null && r.value !== undefined) {
      return { value: r.value, provider: r.provider };
    }

    // Redis answered "not found". A session created during downtime may only exist in memory: promote it.
    if (key.startsWith(SESSION_KEY_PREFIX)) {
      // Silent peek first: a plain miss on a healthy Redis must not produce fallback-cache logs.
      const inMemory = fallbackCache.peek(key);
      if (inMemory !== null) {
        const ttl = await fallbackCache.ttl(key);
        if (ttl === -2) return { value: null, provider: r.provider }; // expired just now; never resurrect it
        const remaining = ttl > 0 ? ttl : DEFAULT_SESSION_TTL_SECONDS;
        const promoted = await promoteSession(key, inMemory, remaining);
        if (promoted.status === "promoted") {
          emit("log", promoted.provider, `Session ${maskKey(key)} promoted from memory into Redis.`);
          // Served from memory on this call, even though it now also lives in Redis.
          return { value: inMemory, provider: "FALLBACK", promotedTo: promoted.provider };
        }
        if (promoted.status === "cancelled") {
          // The in-memory copy vanished while we worked: either it was destroyed (logout) or a concurrent
          // migration already moved it into Redis. Re-read Redis once to tell the two apart.
          const again = await viaRedis("GET", key, (c) => c.get<string>(key), (c) => c.get(key));
          if (again.ok && again.value !== null && again.value !== undefined) {
            return { value: again.value, provider: again.provider };
          }
          return { value: null, provider: r.provider };
        }
        return { value: inMemory, provider: "FALLBACK" };
      }
    }
    return { value: null, provider: r.provider };
  }

  async function setDetailed(key: string, value: string, ttlSeconds?: number): Promise<{ provider: CacheProvider }> {
    const r = await viaRedis(
      "SET",
      key,
      (c) => (ttlSeconds ? c.set(key, value, { ex: ttlSeconds }) : c.set(key, value)),
      (c) => (ttlSeconds ? c.set(key, value, "EX", ttlSeconds) : c.set(key, value))
    );
    if (r.ok) {
      fallbackCache.discard(key); // an older in-memory copy would otherwise be a stale read later
      return { provider: r.provider };
    }
    await fallbackCache.set(key, value, ttlSeconds ? { ex: ttlSeconds } : undefined);
    return { provider: "FALLBACK" };
  }

  async function delDetailed(key: string): Promise<{ provider: CacheProvider }> {
    // Memory first, then Redis: a concurrent migration that re-checks memory after its write can then
    // always tell the key was destroyed (and undo its write) instead of resurrecting the session.
    if (!upstash && !tcp) {
      await fallbackCache.del(key); // memory is the only store: this IS the operation, so it is logged as such
      return { provider: "FALLBACK" };
    }
    const hadMemoryCopy = fallbackCache.peek(key) !== null;
    fallbackCache.discard(key);
    const r = await viaRedis("DEL", key, (c) => c.del(key), (c) => c.del(key));
    if (r.ok) {
      if (hadMemoryCopy) emit("log", "FALLBACK", `Removed in-memory copy of ${maskKey(key)} (Redis delete handled by ${r.provider}).`);
      return { provider: r.provider };
    }
    emit("warn", "FALLBACK", `DEL ${maskKey(key)} applied to memory only; Redis delete did NOT happen (a Redis copy may still exist).`);
    return { provider: "FALLBACK" };
  }

  async function incrDetailed(key: string): Promise<CacheResult<number>> {
    const r = await viaRedis("INCR", key, (c) => c.incr(key), (c) => c.incr(key));
    if (r.ok) return { value: r.value, provider: r.provider };
    return { value: await fallbackCache.incr(key), provider: "FALLBACK" };
  }

  // ---- initialisation --------------------------------------------------------
  if (!upstash && !tcp) {
    fallbackAnnounced = true;
    emit(
      "log",
      "FALLBACK",
      "No Redis provider configured (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or REDIS_URL). Using in-memory cache only; sessions will not survive a restart."
    );
  }

  if (upstash) {
    // A client object proves nothing about connectivity; only a successful round-trip counts as "connected".
    void upstash
      .ping()
      .then(() => {
        upstashSucceeded("ping"); // also triggers session migration if sessions accumulated in memory
        if (!isDev) out.log("Connected to Upstash Redis (REST)");
      })
      .catch((err: unknown) => {
        upstashFailed("PING", undefined, err);
        if (!isDev) out.error("Failed to connect to Upstash Redis:", describeError(err));
      });
  }

  if (tcp) {
    tcp.on("ready", () => {
      tcpWasReady = true;
      hasLoggedOfflineWarning = false;
      fallbackAnnounced = false;
      if (isDev) emit("log", "LOCAL", `Connected & ready (${tcpTarget}).`);
      else out.log(`\n\x1b[32m✔ Redis Connected & Ready\x1b[0m (${tcpTarget})`);
      void migrateFallbackSessions();
    });

    tcp.on("close", () => {
      if (!tcpWasReady) return; // never connected, or already reported
      tcpWasReady = false;
      emit("warn", "LOCAL", `Connection closed (${tcpTarget}); reconnecting in background.`);
      activateFallback("Local Redis connection was lost");
    });

    tcp.on("error", (err: unknown) => {
      if (hasLoggedOfflineWarning) return;
      hasLoggedOfflineWarning = true;
      const reason = describeError(err);
      if (isDev) {
        emit("warn", "LOCAL", `Connection unavailable (${tcpTarget}): ${reason}. Reconnecting in background.`);
        activateFallback("Local Redis is unreachable");
      } else {
        out.log("\n--------------------------------------------------");
        out.log(`\x1b[33m⚠️  Redis Connection Unavailable\x1b[0m`);
        out.log(`Target: \x1b[33m${tcpTarget}\x1b[0m`);
        out.log(`Status: Connection refused (${reason || "ECONNREFUSED"})`);
        out.log(`ℹ️  Operating in in-memory fallback mode. Automatic reconnection active in background.`);
        out.log("--------------------------------------------------\n");
      }
    });

    // Initial connection attempt (errors are handled gracefully by the 'error' event listener)
    tcp.connect().catch(() => {});
  }

  // ---- Unified Cache API -----------------------------------------------------
  const cache = {
    async get(key: string): Promise<string | null> {
      return (await getDetailed(key)).value;
    },

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      await setDetailed(key, value, ttlSeconds);
    },

    async del(key: string): Promise<void> {
      await delDetailed(key);
    },

    async expire(key: string, ttlSeconds: number): Promise<void> {
      const r = await viaRedis("EXPIRE", key, (c) => c.expire(key, ttlSeconds), (c) => c.expire(key, ttlSeconds));
      if (!r.ok) await fallbackCache.expire(key, ttlSeconds);
    },

    async ttl(key: string): Promise<number> {
      const r = await viaRedis("TTL", key, (c) => c.ttl(key), (c) => c.ttl(key));
      return r.ok ? r.value : await fallbackCache.ttl(key);
    },

    async incr(key: string): Promise<number> {
      return (await incrDetailed(key)).value;
    },

    // Provider-aware variants: identical behaviour, but also report who actually handled the operation.
    getWithProvider: getDetailed,
    setWithProvider: setDetailed,
    delWithProvider: delDetailed,
    incrWithProvider: incrDetailed,
  };

  function getStatus() {
    return {
      configuredProvider: (upstash ? "UPSTASH" : tcp ? "LOCAL" : "FALLBACK") as CacheProvider,
      upstashState: upstash ? upstashState : null,
      tcpStatus: tcp ? tcp.status : null,
      fallbackActive: fallbackAnnounced,
      fallbackEntries: fallbackCache.size,
    };
  }

  return { cache, migrateFallbackSessions, getStatus };
}

// ==========================================================================
// Production wiring (environment-driven)
// ==========================================================================
const isDev = process.env["NODE_ENV"] !== "production";
const upstashUrl = process.env["UPSTASH_REDIS_REST_URL"];
const upstashToken = process.env["UPSTASH_REDIS_REST_TOKEN"];
const redisUrl = process.env["REDIS_URL"];

// 1. Production Upstash HTTP Client (Stateless REST)
const upstashClient = upstashUrl && upstashToken ? new UpstashRedis({ url: upstashUrl, token: upstashToken }) : null;

// 2. Local Docker TCP Redis Client (ioredis) with automatic reconnect & exponential backoff.
//    Only created when Upstash credentials are missing (intended provider-selection behaviour).
const tcpClient =
  !upstashClient && redisUrl
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

function redisPassword(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const raw = new URL(url).password;
    return raw ? decodeURIComponent(raw) : undefined;
  } catch {
    return undefined;
  }
}

const instance = createCache({
  // Cast: the real clients are structurally compatible with the minimal interfaces above.
  upstash: upstashClient as unknown as UpstashLike | null,
  tcp: tcpClient as unknown as TcpLike | null,
  tcpTarget: sanitizeRedisUrl(redisUrl),
  isDev,
  secrets: [upstashToken, redisPassword(redisUrl)],
});

export const cache = instance.cache;
export const migrateFallbackSessions = instance.migrateFallbackSessions;
/** Diagnostic snapshot: configured provider, Upstash/TCP state, whether fallback is active. */
export const getCacheStatus = instance.getStatus;