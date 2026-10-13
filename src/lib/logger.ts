// Development-only structured logger utility.
// Provides minimal, meaningful, color-coded terminal logging for Auth, Session, and URL Shortening operations.
// Automatically silenced in Production environments.
// Strictly prevents logging secrets, cookies, raw passwords, or unmasked session tokens.

const isDev = process.env["NODE_ENV"] !== "production";

// --------------------------------------------------------------------------
// Storage provider tags. These describe the provider that ACTUALLY handled an
// operation (as reported by the cache layer), never the configured provider.
// --------------------------------------------------------------------------
export type CacheProvider = "UPSTASH" | "LOCAL" | "FALLBACK";

const PROVIDER_STYLE: Record<CacheProvider, { label: string; color: string }> = {
  LOCAL: { label: "LOCAL REDIS", color: "\x1b[1;32m" },
  UPSTASH: { label: "UPSTASH REDIS", color: "\x1b[1;34m" },
  FALLBACK: { label: "FALLBACK CACHE", color: "\x1b[1;33m" },
};

/** Plain-text label, e.g. "UPSTASH REDIS". */
export function providerLabel(provider: CacheProvider): string {
  return PROVIDER_STYLE[provider].label;
}

/** Colored bracketed tag, e.g. "[UPSTASH REDIS]". */
export function providerTag(provider: CacheProvider): string {
  const { label, color } = PROVIDER_STYLE[provider];
  return `${color}[${label}]\x1b[0m`;
}

function providerPrefix(provider?: CacheProvider): string {
  return provider ? `${providerTag(provider)} ` : "";
}

function getTimestamp(): string {
  const d = new Date();
  return d.toLocaleTimeString([], { hour12: false }) + "." + d.getMilliseconds().toString().padStart(3, "0");
}

export function maskToken(token?: string | null): string {
  if (!token) return "<none>";
  if (token.length <= 8) return token.slice(0, 3) + "...";
  return token.slice(0, 6) + "..." + token.slice(-4);
}

export const logger = {
  /**
   * `provider` is only passed when a storage operation actually happened for this
   * event (i.e. a session was written). Failed attempts that never reached storage
   * (bad password, validation errors) carry no provider tag.
   */
  auth(
    action: "LOGIN" | "SIGNUP",
    email: string,
    success: boolean,
    error?: string,
    userId?: string,
    provider?: CacheProvider
  ) {
    if (!isDev) return;
    const time = getTimestamp();
    const statusText = success
      ? `\x1b[32mSUCCESS\x1b[0m${userId ? ` (userId: ${userId})` : ""}`
      : `\x1b[31mFAILED (${error || "Unknown"})\x1b[0m`;
    const storageNote =
      success && provider === "FALLBACK" ? " | Session: memory-only (NOT persisted in Redis)" : "";
    console.log(
      `${providerPrefix(provider)}\x1b[36m[AUTH:${action}]\x1b[0m ${time} - Email: ${email} | Status: ${statusText}${storageNote}`
    );
  },

  session(
    action: "CREATED" | "VALIDATED" | "DESTROYED",
    userId?: string,
    token?: string,
    provider?: CacheProvider,
    note?: string
  ) {
    if (!isDev) return;
    const time = getTimestamp();
    const userPart = userId ? ` | UserId: ${userId}` : "";
    const tokenPart = token ? ` | Token: ${maskToken(token)}` : "";
    const persistence =
      provider === "FALLBACK" && action === "CREATED" ? " | Persistence: memory-only (NOT persisted in Redis)" : "";
    const notePart = note ? ` | ${note}` : "";
    console.log(
      `${providerPrefix(provider)}\x1b[35m[AUTH:SESSION]\x1b[0m ${time} - Action: ${action}${userPart}${tokenPart}${persistence}${notePart}`
    );
  },

  unauthorized(operation: string, reason: string, token?: string) {
    if (!isDev) return;
    const time = getTimestamp();
    const tokenPart = token ? ` | Token: ${maskToken(token)}` : "";
    console.log(`\x1b[31m[AUTH:UNAUTHORIZED]\x1b[0m ${time} - Operation: ${operation} | Reason: "${reason}"${tokenPart}`);
  },

  shortenerCreate(type: "AUTHENTICATED" | "GUEST", slug: string, targetUrl: string, userId?: string) {
    if (!isDev) return;
    const time = getTimestamp();
    const userPart = userId ? ` | UserId: ${userId}` : "";
    console.log(`\x1b[32m[SHORTENER:CREATE]\x1b[0m ${time} - Type: ${type} | Slug: "/${slug}" -> Target: "${targetUrl}"${userPart}`);
  },

  shortenerDelete(userId: string, linkId: string, success: boolean, reason?: string) {
    if (!isDev) return;
    const time = getTimestamp();
    const statusText = success
      ? "\x1b[32mDELETED\x1b[0m"
      : `\x1b[31mFAILED (${reason || "Unauthorized/Not Found"})\x1b[0m`;
    console.log(`\x1b[33m[SHORTENER:DELETE]\x1b[0m ${time} - UserId: ${userId} | LinkId: ${linkId} | Status: ${statusText}`);
  },

  shortenerList(userId: string, count: number) {
    if (!isDev) return;
    const time = getTimestamp();
    console.log(`\x1b[34m[SHORTENER:LIST]\x1b[0m ${time} - UserId: ${userId} | Retrieved: ${count} links`);
  },

  rateLimit(action: string, identifier: string, limit: number, windowSeconds: number, provider?: CacheProvider) {
    if (!isDev) return;
    const time = getTimestamp();
    console.log(
      `${providerPrefix(provider)}\x1b[31m[RATELIMIT:429]\x1b[0m ${time} - Action: ${action} | Target: ${identifier} | Exceeded limit of ${limit} reqs / ${windowSeconds}s`
    );
  },
};