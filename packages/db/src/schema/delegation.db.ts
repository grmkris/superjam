import { jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { user } from "./user.db.ts";

// Dynamic Delegated Access — the decrypted per-user MPC delegation the server uses
// to sign AS the user (no per-tx popup), for server-side payments + the MCP
// act-as-user flow. Populated by the `wallet.delegation.created` webhook (the
// encrypted share is decrypted with DYNAMIC_DELEGATION_PRIVATE_KEY); removed on
// `wallet.delegation.revoked`. SENSITIVE: `walletApiKey` + `keyShare` are spend
// material — dev stores them as-is; production should envelope-encrypt at rest.
export const userDelegation = pgTable("user_delegation", {
  id: typeIdPk("userDelegation"),
  /** Our user (one delegation per user). */
  userId: typeId("user", "user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  /** Dynamic userId from the webhook (`userId`) — the join key on revoke. */
  dynamicUserId: text("dynamic_user_id").notNull().unique(),
  /** The user's Dynamic embedded-wallet id (`data.walletId`). */
  walletId: text("wallet_id").notNull(),
  /** The wallet's EVM address (`data.publicKey`). */
  address: text("address").notNull(),
  /** Optional share-set id (`data.shareSetId`); omit ⇒ server resolves it. */
  shareSetId: text("share_set_id"),
  /** Decrypted per-wallet API key. */
  walletApiKey: text("wallet_api_key").notNull(),
  /** Decrypted MPC key share (Dynamic `ServerKeyShare` object — kept untyped here
   *  so the Node wallet SDK never enters the web/db type graph; the server casts). */
  keyShare: jsonb("key_share").notNull(),
  ...baseEntityFields,
});

export type UserDelegation = typeof userDelegation.$inferSelect;
export type NewUserDelegation = typeof userDelegation.$inferInsert;
