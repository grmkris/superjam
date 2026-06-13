import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { user } from "./user.db.ts";

// Dynamic Delegated Access (§23) — the decrypted per-user MPC delegation the
// server uses to sign AS the user for private payments (no per-tx popup).
// Populated by the `wallet.delegation.created` webhook (the encrypted share is
// decrypted with DYNAMIC_DELEGATION_PRIVATE_KEY); removed on
// `wallet.delegation.revoked`. SENSITIVE: `walletApiKey` + `keyShare` are spend
// material — testnet stores them as-is; production should encrypt at rest.
export const userDelegation = pgTable("user_delegation", {
  id: typeIdPk("userDelegation"),
  /** Our user (one delegation per user). */
  userId: typeId("user", "user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  /** Dynamic userId from the webhook (`data.userId`) — the join key on revoke. */
  dynamicUserId: text("dynamic_user_id").notNull().unique(),
  /** The user's Dynamic embedded-wallet id (`data.walletId`). */
  walletId: text("wallet_id").notNull(),
  /** The wallet's EVM address (the viem account address used to sign). */
  address: text("address").notNull(),
  /** Decrypted per-wallet API key. */
  walletApiKey: text("wallet_api_key").notNull(),
  /** Decrypted MPC key share (ServerKeyShare object). */
  keyShare: jsonb("key_share").notNull(),
  ...baseEntityFields,
});

export type UserDelegation = typeof userDelegation.$inferSelect;
export type NewUserDelegation = typeof userDelegation.$inferInsert;
