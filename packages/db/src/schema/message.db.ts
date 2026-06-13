import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  varchar,
} from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { app } from "./app.db.ts";
import { user } from "./user.db.ts";

// One-way notify/invite (sdk.messages.send, §9). link is a validated
// platform-origin relative path (/app/<slug>[?d=…]); text is plain, never HTML.
export const appMessage = pgTable(
  "app_message",
  {
    id: typeIdPk("message"),
    appId: typeId("app", "app_id")
      .notNull()
      .references(() => app.id),
    fromUserId: typeId("user", "from_user_id")
      .notNull()
      .references(() => user.id),
    toUserId: typeId("user", "to_user_id")
      .notNull()
      .references(() => user.id),
    text: varchar("text", { length: 280 }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    link: text("link"),
    read: boolean("read").notNull().default(false),
    ...baseEntityFields,
  },
  (t) => [index("app_message_inbox_idx").on(t.toUserId, t.createdAt.desc())]
);

export type AppMessage = typeof appMessage.$inferSelect;
