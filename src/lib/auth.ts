// Core authentication and session logic.
// Sessions are stored exclusively in Redis with a 30-day TTL.
// The session token is transmitted via an HttpOnly cookie set/read by server functions.
// PostgreSQL is used only for user account data — no sessions table.
import { db, schema } from "./db";
import { eq } from "drizzle-orm";
import { cache } from "./redis";
import { logger } from "./logger";
import type { AuthUser, AuthResponse } from "./types";

export type { AuthUser };

// --------------------------------------------------------------------------
// Cookie name used for the session token. HttpOnly is set by the server fn.
// --------------------------------------------------------------------------
export const SESSION_COOKIE = "ziplink_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// --------------------------------------------------------------------------
// Password hashing — PBKDF2 via Web Crypto (runs on the server/edge)
// --------------------------------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", key);
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(new Uint8Array(exported))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, combinedHash: string): Promise<boolean> {
  const [saltHex, hashHex] = combinedHash.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
  );
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", key);
  const testHashHex = Array.from(new Uint8Array(exported))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return testHashHex === hashHex;
}

// --------------------------------------------------------------------------
// In-memory fallback when PostgreSQL DATABASE_URL is not configured
// --------------------------------------------------------------------------
const localUsersMap = new Map<string, { id: string; name: string; email: string; passwordHash: string; createdAt: number }>();

export function generateToken(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --------------------------------------------------------------------------
// Redis session helpers
// --------------------------------------------------------------------------
async function storeSession(token: string, userId: string): Promise<void> {
  const payload = JSON.stringify({ userId, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 });
  await cache.set(`session:${token}`, payload, SESSION_TTL_SECONDS);
}

async function resolveSessionUserId(token: string): Promise<string | null> {
  if (!token) return null;
  const raw = await cache.get(`session:${token}`);
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed.expiresAt > Date.now()) return parsed.userId as string;
  } catch {}
  return null;
}

export async function destroySession(token: string): Promise<void> {
  logger.session("DESTROYED", undefined, token);
  await cache.del(`session:${token}`);
}

// --------------------------------------------------------------------------
// Resolves the authenticated user from a raw session token.
// --------------------------------------------------------------------------
export async function getUserByToken(token: string): Promise<AuthUser | null> {
  const userId = await resolveSessionUserId(token);
  if (!userId) return null;

  if (db) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!u) return null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      role: u.role,
      createdAt: new Date(u.createdAt).getTime(),
    };
  }

  const u = localUsersMap.get(userId);
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: "user", createdAt: u.createdAt };
}

// --------------------------------------------------------------------------
// Register a new user, create a Redis session, return user + token.
// The caller (server fn) sets the HttpOnly cookie.
// --------------------------------------------------------------------------
export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: true; user: AuthUser; token: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!name || name.length < 2) {
    logger.auth("SIGNUP", email || "unknown", false, "Name must be at least 2 characters long");
    return { ok: false, error: "Name must be at least 2 characters long." };
  }
  if (!email || !email.includes("@")) {
    logger.auth("SIGNUP", email || "invalid_email", false, "Invalid email address");
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (!input.password || input.password.length < 6) {
    logger.auth("SIGNUP", email, false, "Password must be at least 6 characters long");
    return { ok: false, error: "Password must be at least 6 characters long." };
  }

  if (db) {
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing.length > 0) {
      logger.auth("SIGNUP", email, false, "Email already exists");
      return { ok: false, error: "An account with this email already exists." };
    }
  } else {
    for (const u of localUsersMap.values()) {
      if (u.email === email) {
        logger.auth("SIGNUP", email, false, "Email already exists");
        return { ok: false, error: "An account with this email already exists." };
      }
    }
  }

  const passwordHash = await hashPassword(input.password);
  let userId: string = crypto.randomUUID();

  if (db) {
    const [inserted] = await db
      .insert(schema.users)
      .values({ name, email, passwordHash })
      .returning();
    if (!inserted) {
      logger.auth("SIGNUP", email, false, "DB insertion error");
      return { ok: false, error: "Could not create user account." };
    }
    userId = inserted.id;
  } else {
    localUsersMap.set(userId, { id: userId, name, email, passwordHash, createdAt: Date.now() });
  }

  const token = generateToken();
  await storeSession(token, userId);

  const user: AuthUser = { id: userId, name, email, role: "user", createdAt: Date.now() };
  logger.auth("SIGNUP", email, true, undefined, userId);
  logger.session("CREATED", userId, token);
  return { ok: true, user, token };
}

// --------------------------------------------------------------------------
// Verify credentials, create a Redis session, return user + token.
// The caller (server fn) sets the HttpOnly cookie.
// --------------------------------------------------------------------------
export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ ok: true; user: AuthUser; token: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();

  let targetUser:
    | { id: string; name: string; email: string; passwordHash: string; avatarUrl?: string | null; role?: string; createdAt?: any }
    | undefined;

  if (db) {
    const [userRecord] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    targetUser = userRecord;
  } else {
    for (const u of localUsersMap.values()) {
      if (u.email === email) { targetUser = u; break; }
    }
  }

  if (!targetUser) {
    logger.auth("LOGIN", email, false, "User not found");
    return { ok: false, error: "Invalid email or password." };
  }

  const isValid = await verifyPassword(input.password, targetUser.passwordHash);
  if (!isValid) {
    logger.auth("LOGIN", email, false, "Invalid password");
    return { ok: false, error: "Invalid email or password." };
  }

  const token = generateToken();
  await storeSession(token, targetUser.id);

  const user: AuthUser = {
    id: targetUser.id,
    name: targetUser.name,
    email: targetUser.email,
    avatarUrl: targetUser.avatarUrl ?? null,
    role: targetUser.role || "user",
    createdAt:
      typeof targetUser.createdAt === "number"
        ? targetUser.createdAt
        : new Date(targetUser.createdAt || Date.now()).getTime(),
  };

  logger.auth("LOGIN", email, true, undefined, targetUser.id);
  logger.session("CREATED", targetUser.id, token);
  return { ok: true, user, token };
}
