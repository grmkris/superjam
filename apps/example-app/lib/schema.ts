// The app's OWN database schema (pivot §5) — proof that an external mini-app
// brings its own DB. Identity columns are stamped from the VERIFIED SuperJam
// token (lib/superjam.ts), never from the client. Keyed by the platform userId.
import {
  boolean,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  // SuperJam identity, stamped server-side from the verified token:
  superjamUserId: text("superjam_user_id").notNull(),
  username: text("username").notNull(),
  worldVerified: boolean("world_verified").notNull().default(false),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Entry = typeof entries.$inferSelect;
