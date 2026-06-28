// directMessage (§3e) — the user↔user chat stream (friendship-gated). Distinct
// from appMessage (app→user one-way inbox). A `card` row carries an app/host
// render-spec (PLAIN TEXT only — rendered by the host, never as HTML) + a
// validated platform-origin deeplink `link` (/app/<slug>[?d=…]); `viaAppId`
// attributes the jam that produced a card/tip ("via <jam>" + icon). `tip` rows
// carry the money line (the USDC already moved via the confirm sheet).
import { boolean, index, jsonb, pgTable, text, varchar } from "drizzle-orm/pg-core";
import type { DmCard } from "@superjam/shared";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { app } from "./app.db.ts";
import { dmKindEnum } from "./enums.db.ts";
import { user } from "./user.db.ts";

export const directMessage = pgTable(
  "direct_message",
  {
    id: typeIdPk("directMessage"),
    fromUserId: typeId("user", "from_user_id")
      .notNull()
      .references(() => user.id),
    toUserId: typeId("user", "to_user_id")
      .notNull()
      .references(() => user.id),
    viaAppId: typeId("app", "via_app_id").references(() => app.id),
    kind: dmKindEnum("kind").notNull().default("text"),
    text: varchar("text", { length: 1024 }),
    card: jsonb("card").$type<DmCard>(),
    link: text("link"),
    amountUsdc: text("amount_usdc"),
    txHash: text("tx_hash"),
    read: boolean("read").notNull().default(false),
    ...baseEntityFields,
  },
  (t) => [
    index("direct_message_to_idx").on(t.toUserId, t.createdAt.desc()),
    index("direct_message_pair_idx").on(
      t.fromUserId,
      t.toUserId,
      t.createdAt.desc()
    ),
  ]
);

export type DirectMessage = typeof directMessage.$inferSelect;
