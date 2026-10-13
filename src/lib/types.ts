export type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: string;
  createdAt: number;
};

export type AuthResponse =
  | { ok: true; user: AuthUser; token?: string }
  | { ok: false; error: string; status?: number };

export type ShortLink = {
  id: string;
  userId?: string | null;
  title?: string | null;
  originalUrl: string;
  shortUrl: string;
  slug: string;
  createdAt: number;
  clicksCount: number;
  expiresAt?: number | null;
  hasPassword?: boolean;
};

export type ShortenResult =
  | { ok: true; link: ShortLink }
  | { ok: false; error: string; status?: number };

export type UserLinksResult =
  | { ok: true; links: ShortLink[] }
  | { ok: false; error: string; status: number };

export type DeleteLinkResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export type ClickMeta = {
  referer?: string;
  country?: string;
  device?: string;
  browser?: string;
};
