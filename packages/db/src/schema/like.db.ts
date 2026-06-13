import { index, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { baseEntityFields, typeId } from "../utils/db-utils.ts";
import { app } from "./app.db.ts";
import { user } from "./user.db.ts";

// A like on a jam. Composite PK(appId,userId) = one like per human per jam and an
// idempotent toggle (insert/delete). The per-app COUNT is the feed's like total;
// counting likes whose userId is in the viewer's friend set gives the real
// "N friends liked" social signal (there is no per-user PLAY log to power a
// "friends played" metric, so likes carry it).
export const appLike = pgTable(
  "app_like",
  {
    appId: typeId("app", "app_id")
      .notNull()
      .references(() => app.id),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id),
    ...baseEntityFields,
  },
  (t) => [
    primaryKey({ columns: [t.appId, t.userId] }),
    // friends-liked count filters by userId then groups by appId
    index("app_like_user_idx").on(t.userId),
  ]
);

export type AppLike = typeof appLike.$inferSelect;
