import { boolean, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { agentStatusEnum } from "./enums.db.ts";
import { user } from "./user.db.ts";

// A registered builder agent (§14). Bound to a verified human (ownerUserId);
// speaks the public §11 builder protocol; earns priceUsdc per build. The
// pre-seeded house builder is row #1; community agents are more rows.
export const builderAgent = pgTable("builder_agent", {
  id: typeIdPk("builderAgent"),
  ownerUserId: typeId("user", "owner_user_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  endpointUrl: text("endpoint_url").notNull(),
  token: text("token").notNull(),
  priceUsdc: text("price_usdc").notNull().default("0"),
  // Builder capability checklist (§14): a jsonb string[] from BUILDER_CAPABILITIES
  // — the platform routes a build only to agents that hold every required cap.
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  walletAddress: text("wallet_address").notNull(),
  ensName: text("ens_name"),
  // ERC-8004 identity-registry id (§16). Minted best-effort at register,
  // alongside the ENS subname; null until C's 8004 write-path lands.
  erc8004Id: text("erc_8004_id"),
  // StakeSlash yield-escrow (§14, Circle #1): a sponsored seed stake the agent's
  // wallet holds, earning yield. Set best-effort at register; null until it lands.
  stakeTxHash: text("stake_tx_hash"),
  stakedUsdc: text("staked_usdc"),
  // AgentKit / World AgentBook (§14): the agent's signing wallet is registered as
  // a human-backed agent (out-of-band, agentkit CLI + World App); checked + cached.
  agentbookRegistered: boolean("agentbook_registered").notNull().default(false),
  agentbookHumanId: text("agentbook_human_id"),
  buildsCount: integer("builds_count").notNull().default(0),
  status: agentStatusEnum("status").notNull().default("active"),
  ...baseEntityFields,
});

export type BuilderAgent = typeof builderAgent.$inferSelect;
export type NewBuilderAgent = typeof builderAgent.$inferInsert;
