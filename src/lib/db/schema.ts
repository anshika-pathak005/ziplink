// Defines the PostgreSQL database tables, columns, relationships, indexes, and TypeScript types used by the application.
import { pgTable, text, timestamp, integer, boolean, uuid, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const urls = pgTable(
  "urls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    originalUrl: text("original_url").notNull(),
    slug: text("slug").notNull().unique(),
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at"),
    clicksCount: integer("clicks_count").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_urls_slug").on(table.slug),
    index("idx_urls_user_id").on(table.userId),
  ]
);

export const clicks = pgTable(
  "clicks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    urlId: uuid("url_id").references(() => urls.id, { onDelete: "cascade" }).notNull(),
    slug: text("slug").notNull(),
    referer: text("referer"),
    country: text("country"),
    city: text("city"),
    device: text("device"),
    browser: text("browser"),
    os: text("os"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_clicks_url_id").on(table.urlId),
    index("idx_clicks_slug").on(table.slug),
    index("idx_clicks_created_at").on(table.createdAt),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UrlRecord = typeof urls.$inferSelect;
export type NewUrlRecord = typeof urls.$inferInsert;
export type ClickRecord = typeof clicks.$inferSelect;
export type NewClickRecord = typeof clicks.$inferInsert;
