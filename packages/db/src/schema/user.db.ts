import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { baseEntityFields, typeIdPk } from "../utils/db-utils.ts";

// One account per login. ensName is minted on username claim
// (username.superjam.eth, §11/§14). worldVerified is surfaced to mini-apps over
// the SDK bridge (kept even though the verify flow was removed).
export const user = pgTable("user", {
  id: typeIdPk("user"),
  ensName: text("ens_name"),
  dynamicUserId: text("dynamic_user_id").unique(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  walletAddress: text("wallet_address"),
  worldVerified: boolean("world_verified").notNull().default(false),
  freeBuildsUsed: integer("free_builds_used").notNull().default(0),
  lastTopupAt: timestamp("last_topup_at", { withTimezone: true, mode: "date" }),
  ...baseEntityFields,
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
