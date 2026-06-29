// Per-app data plane — the SQLite (libSQL/Turso) tables that live in EACH app's
// own database. These are the `appRecord`/`appCounter`/`appStorage` shapes from
// storage.db.ts MINUS `appId` (the database IS the app's). Bound per request by
// the platform runtime (see ../libsql.ts) and exposed to the bridge services as
// the app's ctx.db. Identity (userId/username/worldVerified) is server-stamped.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** sdk.data.collection — shared docs everyone in the app sees. */
export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    collection: text("collection").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    worldVerified: integer("world_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    data: text("data", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("records_collection_created").on(t.collection, t.createdAt)]
);

/** sdk.data.counter — atomic tallies (the leaderboard primitive). */
export const counters = sqliteTable(
  "counters",
  {
    counter: text("counter").notNull(),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.counter, t.key] }),
    index("counters_top").on(t.counter, t.value),
  ]
);

/** sdk.storage — per-user private KV. */
export const storage = sqliteTable(
  "storage",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })]
);

export type RecordRow = typeof records.$inferSelect;
export type CounterRow = typeof counters.$inferSelect;
export type StorageRow = typeof storage.$inferSelect;
