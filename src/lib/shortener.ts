// Contains the core business logic for creating, validating, finding, and tracking
// shortened URLs.
// It handles URL validation, short slug generation, database operations, Redis caching,
// and click tracking so that route files can focus mainly on handling requests and responses.
import { db, schema } from "./db";
import { eq, desc, and } from "drizzle-orm";
import { cache } from "./redis";
import { logger } from "./logger";
import type { ShortLink, ShortenResult } from "./types";

export type { ShortLink, ShortenResult };

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function makeSlug(length = 7) {
  let out = "";
  const bytes =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint8Array(length))
      : Array.from({ length }, () => Math.floor(Math.random() * 256));
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function normalizeUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  // Strict Security Check: Whitelist http:// and https:// protocols only
  // Prevent XSS vectors like javascript:, data:, file:, vbscript:
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(withProtocol);

    // Reject non-http(s) schemes even if URL constructor accepts them
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    // Check for valid hostname with at least one dot or localhost
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

// In-Memory store fallback for local dev when PostgreSQL is not connected yet
const localLinksMap = new Map<string, ShortLink>();

export async function shortenUrl(
  input: string,
  options: {
    customSlug?: string;
    title?: string;
    userId?: string;
    expiresAt?: number;
    password?: string;
  } = {}
): Promise<ShortenResult> {
  const originalUrl = normalizeUrl(input);
  if (!originalUrl) {
    return { ok: false, error: "Please enter a valid HTTP or HTTPS Web URL." };
  }

  let slug = options.customSlug?.trim();
  if (slug) {
    // Sanitize custom slug (only allow alphanumeric, hyphens, and underscores)
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(slug)) {
      return {
        ok: false,
        error: "Custom slug must be 3-30 characters (letters, numbers, hyphens, underscores).",
      };
    }

    // Check if slug is taken
    const existing = await getLinkBySlug(slug);
    if (existing) {
      return { ok: false, error: "That custom slug is already taken. Try another!" };
    }
  } else {
    // Generate unique slug
    let attempts = 0;
    while (attempts < 5) {
      const candidate = makeSlug();
      const existing = await getLinkBySlug(candidate);
      if (!existing) {
        slug = candidate;
        break;
      }
      attempts++;
    }
    if (!slug) slug = makeSlug(8);
  }

  const appUrl = process.env["APP_URL"] || process.env["SITE_URL"] || process.env["VITE_APP_URL"] || "http://localhost:3000";
  const origin = typeof window !== "undefined" ? window.location.origin : appUrl;
  const shortUrl = `${origin.replace(/^https?:\/\//, "")}/${slug}`;
  const now = Date.now();

  const linkObj: ShortLink = {
    id: crypto.randomUUID(),
    userId: options.userId ?? null,
    title: options.title?.trim() || new URL(originalUrl).hostname,
    originalUrl,
    shortUrl,
    slug,
    createdAt: now,
    clicksCount: 0,
    expiresAt: options.expiresAt ?? null,
    hasPassword: !!options.password,
  };

  // Write to PostgreSQL DB if connected
  if (db) {
    try {
      const [inserted] = await db
        .insert(schema.urls)
        .values({
          userId: options.userId,
          title: linkObj.title,
          originalUrl,
          slug,
          expiresAt: options.expiresAt ? new Date(options.expiresAt) : null,
          clicksCount: 0,
        })
        .returning();
      if (inserted) {
        linkObj.id = inserted.id;
      }
    } catch (err) {
      console.error("DB Insert Error:", err);
    }
  } else {
    localLinksMap.set(slug, linkObj);
  }

  // Cache in Redis for sub-5ms lookup speed
  await cache.set(`slug:${slug}`, JSON.stringify(linkObj));

  if (options.userId) {
    logger.shortenerCreate("AUTHENTICATED", slug, originalUrl, options.userId);
  } else {
    logger.shortenerCreate("GUEST", slug, originalUrl);
  }

  return { ok: true, link: linkObj };
}

export async function getLinkBySlug(slug: string): Promise<ShortLink | null> {
  if (!slug) return null;

  // 1. Try Redis cache first (Fast Path)
  const cached = await cache.get(`slug:${slug}`);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ShortLink;
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        await cache.del(`slug:${slug}`);
        return null;
      }
      return parsed;
    } catch {}
  }

  // 2. Fallback to PostgreSQL DB
  if (db) {
    try {
      const [record] = await db.select().from(schema.urls).where(eq(schema.urls.slug, slug)).limit(1);
      if (!record || !record.isActive) return null;
      if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return null;

      const appUrl = process.env["APP_URL"] || process.env["SITE_URL"] || process.env["VITE_APP_URL"] || "http://localhost:3000";
      const origin = typeof window !== "undefined" ? window.location.origin : appUrl;
      const linkObj: ShortLink = {
        id: record.id,
        userId: record.userId,
        title: record.title,
        originalUrl: record.originalUrl,
        shortUrl: `${origin.replace(/^https?:\/\//, "")}/${record.slug}`,
        slug: record.slug,
        createdAt: new Date(record.createdAt).getTime(),
        clicksCount: record.clicksCount,
        expiresAt: record.expiresAt ? new Date(record.expiresAt).getTime() : null,
        hasPassword: !!record.passwordHash,
      };

      // Populate Redis cache for subsequent clicks
      await cache.set(`slug:${slug}`, JSON.stringify(linkObj));
      return linkObj;
    } catch (err) {
      console.error("DB Slug Query Error:", err);
    }
  }

  // 3. Fallback to Local Map
  const local = localLinksMap.get(slug);
  if (local) {
    if (local.expiresAt && Date.now() > local.expiresAt) {
      localLinksMap.delete(slug);
      return null;
    }
    return local;
  }

  return null;
}

export async function recordClick(slug: string, meta: { referer?: string; country?: string; device?: string; browser?: string } = {}) {
  // Asynchronously increment click count in Redis
  await cache.incr(`clicks:${slug}`);

  // Async update in DB
  const link = await getLinkBySlug(slug);
  if (link && db) {
    try {
      await db
        .update(schema.urls)
        .set({ clicksCount: link.clicksCount + 1 })
        .where(eq(schema.urls.id, link.id));

      await db.insert(schema.clicks).values({
        urlId: link.id,
        slug,
        referer: meta.referer,
        country: meta.country,
        device: meta.device,
        browser: meta.browser,
      });
    } catch (err) {
      console.error("Record Click DB error:", err);
    }
  } else if (link) {
    link.clicksCount += 1;
  }
}

export async function getUserLinks(userId: string): Promise<ShortLink[]> {
  if (!userId) return [];

  const appUrl = process.env["APP_URL"] || process.env["SITE_URL"] || process.env["VITE_APP_URL"] || "http://localhost:3000";
  const origin = typeof window !== "undefined" ? window.location.origin : appUrl;

  let results: ShortLink[] = [];

  if (db) {
    try {
      const records = await db
        .select()
        .from(schema.urls)
        .where(and(eq(schema.urls.userId, userId), eq(schema.urls.isActive, true)))
        .orderBy(desc(schema.urls.createdAt));

      results = records.map((record) => ({
        id: record.id,
        userId: record.userId,
        title: record.title,
        originalUrl: record.originalUrl,
        shortUrl: `${origin.replace(/^https?:\/\//, "")}/${record.slug}`,
        slug: record.slug,
        createdAt: new Date(record.createdAt).getTime(),
        clicksCount: record.clicksCount,
        expiresAt: record.expiresAt ? new Date(record.expiresAt).getTime() : null,
        hasPassword: !!record.passwordHash,
      }));
    } catch (err) {
      console.error("getUserLinks DB error:", err);
    }
  } else {
    for (const link of localLinksMap.values()) {
      if (link.userId === userId) results.push(link);
    }
    results.sort((a, b) => b.createdAt - a.createdAt);
  }

  logger.shortenerList(userId, results.length);
  return results;
}

export async function deleteUserLink(linkId: string, userId: string): Promise<boolean> {
  if (db) {
    try {
      const [record] = await db.select().from(schema.urls).where(eq(schema.urls.id, linkId)).limit(1);
      if (record && record.userId === userId) {
        await db.delete(schema.urls).where(eq(schema.urls.id, linkId));
        await cache.del(`slug:${record.slug}`);
        logger.shortenerDelete(userId, linkId, true);
        return true;
      }
      logger.shortenerDelete(userId, linkId, false, record ? "Ownership Mismatch" : "Link Not Found");
    } catch (err) {
      console.error("deleteUserLink DB error:", err);
      logger.shortenerDelete(userId, linkId, false, "Database Error");
    }
  } else {
    for (const [slug, link] of localLinksMap.entries()) {
      if (link.id === linkId && link.userId === userId) {
        localLinksMap.delete(slug);
        await cache.del(`slug:${slug}`);
        logger.shortenerDelete(userId, linkId, true);
        return true;
      }
    }
    logger.shortenerDelete(userId, linkId, false, "Not Found or Mismatch");
  }
  return false;
}
