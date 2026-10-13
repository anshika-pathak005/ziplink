// Rate limiting engine using Redis/cache infrastructure.
// Supports both Upstash Cloud Redis and local fallback cache.
// Provides IP extraction, TTL counters, and structured 429 response handling.
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { cache } from "./redis";
import { logger } from "./logger";

export type RateLimitConfig = {
  limit: number;
  windowSeconds: number;
  errorMessage: string;
};

export const RATE_LIMIT_CONFIGS = {
  LOGIN: {
    limit: 5,
    windowSeconds: 15 * 60, // 15 minutes
    errorMessage: "Too many login attempts. Please try again after 15 minutes.",
  },
  SIGNUP: {
    limit: 5,
    windowSeconds: 60 * 60, // 1 hour
    errorMessage: "Too many accounts created from this IP. Please try again after an hour.",
  },
  GUEST_SHORTEN: {
    limit: 10,
    windowSeconds: 10 * 60, // 10 minutes
    errorMessage:
      "Guest URL creation rate limit exceeded (10 links / 10 min). Please create a free account for higher limits.",
  },
  AUTH_SHORTEN: {
    limit: 60,
    windowSeconds: 60, // 1 minute
    errorMessage:
      "Rate limit exceeded (60 links / min). Please wait a moment before creating more links.",
  },
} as const;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
  error?: string;
  status?: number;
};

export function getClientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip && ip !== "unknown" && ip !== "::1") return ip;

    const forwarded = getRequestHeader("x-forwarded-for" as any);
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }

    const realIp = getRequestHeader("x-real-ip" as any);
    if (realIp?.trim()) return realIp.trim();

    const cfIp = getRequestHeader("cf-connecting-ip" as any);
    if (cfIp?.trim()) return cfIp.trim();
  } catch {
    // Outside active server request context
  }
  return "127.0.0.1";
}

/**
 * Checks and increments a rate limit key in Redis.
 * Uses atomic INCR with EXPIRE to track request counts over a sliding or fixed time window.
 */
export async function checkRateLimit(
  action: "LOGIN" | "SIGNUP" | "GUEST_SHORTEN" | "AUTH_SHORTEN",
  identifier: string,
  customConfig?: Partial<RateLimitConfig>,
): Promise<RateLimitResult> {
  const config: RateLimitConfig = {
    ...RATE_LIMIT_CONFIGS[action],
    ...customConfig,
  };

  const redisKey = `ratelimit:${action.toLowerCase()}:${identifier}`;
  // `provider` is the store that actually counted this hit (UPSTASH / LOCAL / FALLBACK), used for accurate 429 logs.
  const { value: current, provider } = await cache.incrWithProvider(redisKey);

  // If this is the first hit in the window (or if TTL was missing), set the expiration
  if (current === 1) {
    await cache.expire(redisKey, config.windowSeconds);
  } else {
    // Safety check: ensure TTL exists
    const ttl = await cache.ttl(redisKey);
    if (ttl === -1) {
      await cache.expire(redisKey, config.windowSeconds);
    }
  }

  const remaining = Math.max(0, config.limit - current);
  const allowed = current <= config.limit;

  if (!allowed) {
    logger.rateLimit(action, identifier, config.limit, config.windowSeconds, provider);
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetInSeconds: config.windowSeconds,
      error: config.errorMessage,
      status: 429,
    };
  }

  return {
    allowed: true,
    limit: config.limit,
    remaining,
    resetInSeconds: config.windowSeconds,
  };
}
