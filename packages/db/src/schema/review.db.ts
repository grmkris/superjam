import { check, integer, pgTable, unique, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { app } from "./app.db.ts";
import { user } from "./user.db.ts";

// One review per human per jam (§7). UNIQUE(appId,userId) makes a second
// submit an edit; every reviewer is World-verified by construction (§14).
export const appReview = pgTable(
  "app_review",
  {
    id: typeIdPk("review"),
    appId: typeId("app", "app_id")
      .notNull()
      .references(() => app.id),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id),
    rating: integer("rating").notNull(),
    text: varchar("text", { length: 280 }),
    ...baseEntityFields,
  },
  (t) => [
    unique("app_review_one_per_human").on(t.appId, t.userId),
    check("app_review_rating_range", sql`${t.rating} >= 1 AND ${t.rating} <= 5`),
  ]
);

export type AppReview = typeof appReview.$inferSelect;
