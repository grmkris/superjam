import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { app } from "./app.db.ts";
import { user } from "./user.db.ts";

// Per-user private KV (saves/settings). PK(appId, userId, key).
export const appStorage = pgTable(
  "app_storage",
  {
    appId: typeId("app", "app_id")
      .notNull()
      .references(() => app.id),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id),
    key: varchar("key", { length: 128 }).notNull(),
    value: jsonb("value"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.appId, t.userId, t.key] })]
);

// App-public shared collection. Identity (userId/username/worldVerified) is
// server-stamped, never trusted from the iframe.
export const appRecord = pgTable(
  "app_record",
  {
    id: typeIdPk("record"),
    appId: typeId("app", "app_id")
      .notNull()
      .references(() => app.id),
    collection: varchar("collection", { length: 64 }).notNull(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id),
    username: text("username").notNull(),
    worldVerified: boolean("world_verified").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    ...baseEntityFields,
  },
  (t) => [index("app_record_list_idx").on(t.appId, t.collection, t.createdAt.desc())]
);

// Atomic counters — the leaderboard primitive. Reserved names (_plays,
// _ai_quota, _x402_quota) reuse this table (§7). PK(appId, counter, key).
export const appCounter = pgTable(
  "app_counter",
  {
    appId: typeId("app", "app_id")
      .notNull()
      .references(() => app.id),
    counter: varchar("counter", { length: 64 }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    value: bigint("value", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    primaryKey({ columns: [t.appId, t.counter, t.key] }),
    index("app_counter_top_idx").on(t.appId, t.counter, t.value.desc()),
  ]
);

export type AppStorageRow = typeof appStorage.$inferSelect;
export type AppRecordRow = typeof appRecord.$inferSelect;
export type AppCounterRow = typeof appCounter.$inferSelect;
