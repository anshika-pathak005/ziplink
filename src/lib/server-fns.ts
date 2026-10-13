import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import type {
  AuthResponse,
  AuthUser,
  ShortenResult,
  UserLinksResult,
  DeleteLinkResult,
  ShortLink,
  ClickMeta,
} from "./types";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./auth";
import { logger } from "./logger";
import { checkRateLimit, getClientIp } from "./ratelimit";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

// --------------------------------------------------------------------------
// Auth: Register User
// Sets the HttpOnly session cookie on the response so the client never touches the token.
// --------------------------------------------------------------------------
export const registerUserFn = createServerFn({ method: "POST" })
  .validator((data: { name: string; email: string; password: string }) => data)
  .handler(async ({ data }): Promise<AuthResponse> => {
    const clientIp = getClientIp();
    const rateLimit = await checkRateLimit("SIGNUP", clientIp);
    if (!rateLimit.allowed) {
      return {
        ok: false,
        error:
          rateLimit.error ||
          "Too many accounts created from this IP. Please try again after an hour.",
        status: 429,
      };
    }

    const { registerUser } = await import("./auth");
    const result = await registerUser(data);
    if (!result.ok) {
      return result;
    }

    // Set the HttpOnly session cookie
    setCookie(SESSION_COOKIE, result.token, COOKIE_OPTIONS);

    return { ok: true, user: result.user };
  });

// --------------------------------------------------------------------------
// Auth: Login User
// Sets the HttpOnly session cookie on the response.
// --------------------------------------------------------------------------
export const loginUserFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }): Promise<AuthResponse> => {
    const clientIp = getClientIp();
    const rateLimit = await checkRateLimit("LOGIN", clientIp);
    if (!rateLimit.allowed) {
      return {
        ok: false,
        error:
          rateLimit.error ||
          "Too many login attempts. Please try again after 15 minutes.",
        status: 429,
      };
    }

    const { loginUser } = await import("./auth");
    const result = await loginUser(data);
    if (!result.ok) {
      return result;
    }

    // Set the HttpOnly session cookie
    setCookie(SESSION_COOKIE, result.token, COOKIE_OPTIONS);

    return { ok: true, user: result.user };
  });

// --------------------------------------------------------------------------
// Auth: Get Current Authenticated User
// Validates the session cookie against Redis and fetches the user object.
// Called on app mount and page refresh.
// --------------------------------------------------------------------------
export const getCurrentUserFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<AuthUser | null> => {
    const token = getCookie(SESSION_COOKIE);
    if (!token) return null;

    const { getUserByToken } = await import("./auth");
    const user = await getUserByToken(token);

    if (!user) {
      logger.unauthorized("SESSION_VALIDATE", "Session expired or invalid in Redis", token);
      deleteCookie(SESSION_COOKIE, { path: "/" });
      return null;
    }

    logger.session("VALIDATED", user.id, token);
    return user;
  });

// --------------------------------------------------------------------------
// Auth: Logout User
// Revokes the Redis session and clears the HttpOnly cookie.
// --------------------------------------------------------------------------
export const logoutUserFn = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ ok: boolean }> => {
    const token = getCookie(SESSION_COOKIE);
    if (token) {
      const { destroySession } = await import("./auth");
      await destroySession(token);
    }
    deleteCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

// --------------------------------------------------------------------------
// URL Shortening: Supports both Authenticated (Dashboard) and Guest (Home) modes.
// When requireAuth is true, strictly validates session in Redis and returns 401 if missing/expired.
// --------------------------------------------------------------------------
export const shortenUrlFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      url: string;
      options?: {
        customSlug?: string;
        title?: string;
        expiresAt?: number;
        password?: string;
      };
      requireAuth?: boolean;
    }) => data,
  )
  .handler(async ({ data }): Promise<ShortenResult> => {
    const token = getCookie(SESSION_COOKIE);

    if (data.requireAuth) {
      if (!token) {
        logger.unauthorized("CREATE_LINK", "Missing session token on authenticated request");
        return {
          ok: false,
          error: "Your session has expired. Please log in again.",
          status: 401,
        };
      }

      const { getUserByToken } = await import("./auth");
      const user = await getUserByToken(token);
      if (!user) {
        logger.unauthorized("CREATE_LINK", "Session expired or invalid in Redis", token);
        deleteCookie(SESSION_COOKIE, { path: "/" });
        return {
          ok: false,
          error: "Your session has expired. Please log in again.",
          status: 401,
        };
      }

      // Authenticated Rate Limiting (60 links / 1 min per userId)
      const rateLimit = await checkRateLimit("AUTH_SHORTEN", user.id);
      if (!rateLimit.allowed) {
        return {
          ok: false,
          error:
            rateLimit.error ||
            "Rate limit exceeded (60 links / min). Please wait a moment before creating more links.",
          status: 429,
        };
      }

      const { shortenUrl } = await import("./shortener");
      const options: {
        customSlug?: string;
        title?: string;
        userId?: string;
        expiresAt?: number;
        password?: string;
      } = { userId: user.id };

      if (data.options?.customSlug !== undefined) options.customSlug = data.options.customSlug;
      if (data.options?.title !== undefined) options.title = data.options.title;
      if (data.options?.expiresAt !== undefined) options.expiresAt = data.options.expiresAt;
      if (data.options?.password !== undefined) options.password = data.options.password;

      return shortenUrl(data.url, options);
    }

    // Public / Guest shortening from Home Page (with optional user association if valid session exists)
    let userId: string | undefined;
    if (token) {
      const { getUserByToken } = await import("./auth");
      const user = await getUserByToken(token);
      if (user) {
        userId = user.id;
      }
    }

    if (userId) {
      // Authenticated Rate Limiting (60 links / 1 min per userId)
      const rateLimit = await checkRateLimit("AUTH_SHORTEN", userId);
      if (!rateLimit.allowed) {
        return {
          ok: false,
          error:
            rateLimit.error ||
            "Rate limit exceeded (60 links / min). Please wait a moment before creating more links.",
          status: 429,
        };
      }
    } else {
      // Guest Rate Limiting (10 links / 10 min per IP)
      const clientIp = getClientIp();
      const rateLimit = await checkRateLimit("GUEST_SHORTEN", clientIp);
      if (!rateLimit.allowed) {
        return {
          ok: false,
          error:
            rateLimit.error ||
            "Guest URL creation rate limit exceeded (10 links / 10 min). Please create a free account for higher limits.",
          status: 429,
        };
      }
    }

    const { shortenUrl } = await import("./shortener");
    const options: {
      customSlug?: string;
      title?: string;
      userId?: string;
      expiresAt?: number;
      password?: string;
    } = {};

    if (data.options?.customSlug !== undefined) options.customSlug = data.options.customSlug;
    if (data.options?.title !== undefined) options.title = data.options.title;
    if (data.options?.expiresAt !== undefined) options.expiresAt = data.options.expiresAt;
    if (data.options?.password !== undefined) options.password = data.options.password;
    if (userId !== undefined) options.userId = userId;

    return shortenUrl(data.url, options);
  });

// --------------------------------------------------------------------------
// Protected: Get User Links
// Derives userId exclusively from the verified session cookie in Redis.
// Returns 401 Unauthorized if the session is missing or expired.
// --------------------------------------------------------------------------
export const getUserLinksFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<UserLinksResult> => {
    const token = getCookie(SESSION_COOKIE);
    if (!token) {
      logger.unauthorized("GET_USER_LINKS", "Missing session cookie on authenticated request");
      return {
        ok: false,
        error: "Your session has expired. Please log in again.",
        status: 401,
      };
    }

    const { getUserByToken } = await import("./auth");
    const user = await getUserByToken(token);
    if (!user) {
      logger.unauthorized("GET_USER_LINKS", "Session expired or invalid in Redis", token);
      deleteCookie(SESSION_COOKIE, { path: "/" });
      return {
        ok: false,
        error: "Your session has expired. Please log in again.",
        status: 401,
      };
    }

    const { getUserLinks } = await import("./shortener");
    const links = await getUserLinks(user.id);
    return { ok: true, links };
  });

// --------------------------------------------------------------------------
// Protected: Delete User Link
// Verifies user ownership via Redis session cookie — returns 401 on expired session.
// --------------------------------------------------------------------------
export const deleteUserLinkFn = createServerFn({ method: "POST" })
  .validator((data: { linkId: string }) => data)
  .handler(async ({ data }): Promise<DeleteLinkResult> => {
    const token = getCookie(SESSION_COOKIE);
    if (!token) {
      logger.unauthorized("DELETE_LINK", "Missing session cookie on authenticated request");
      return {
        ok: false,
        error: "Your session has expired. Please log in again.",
        status: 401,
      };
    }

    const { getUserByToken } = await import("./auth");
    const user = await getUserByToken(token);
    if (!user) {
      logger.unauthorized("DELETE_LINK", "Session expired or invalid in Redis", token);
      deleteCookie(SESSION_COOKIE, { path: "/" });
      return {
        ok: false,
        error: "Your session has expired. Please log in again.",
        status: 401,
      };
    }

    const { deleteUserLink } = await import("./shortener");
    const deleted = await deleteUserLink(data.linkId, user.id);
    if (!deleted) {
      return {
        ok: false,
        error: "Short link not found or you are not authorized to delete it.",
        status: 403,
      };
    }

    return { ok: true };
  });

// --------------------------------------------------------------------------
// Public: Get Link by Slug (for redirection)
// --------------------------------------------------------------------------
export const getLinkBySlugFn = createServerFn({ method: "GET" })
  .validator((data: string | { slug: string }) => data)
  .handler(async ({ data }): Promise<ShortLink | null> => {
    const { getLinkBySlug } = await import("./shortener");
    const slug = typeof data === "string" ? data : data.slug;
    return getLinkBySlug(slug);
  });

// --------------------------------------------------------------------------
// Public: Record Click Analytics
// --------------------------------------------------------------------------
export const recordClickFn = createServerFn({ method: "POST" })
  .validator((data: { slug: string; meta?: ClickMeta }) => data)
  .handler(async ({ data }): Promise<void> => {
    const { recordClick } = await import("./shortener");
    return recordClick(data.slug, data.meta);
  });

// --------------------------------------------------------------------------
// Public: Combined Link Resolution & Click Telemetry
// --------------------------------------------------------------------------
export const getLinkAndRecordClickFn = createServerFn({ method: "GET" })
  .validator((data: string | { slug: string }) => data)
  .handler(async ({ data }): Promise<ShortLink | null> => {
    const { getLinkBySlug, recordClick } = await import("./shortener");
    const slug = typeof data === "string" ? data : data.slug;
    const link = await getLinkBySlug(slug);
    if (link) {
      void recordClick(slug);
    }
    return link;
  });
