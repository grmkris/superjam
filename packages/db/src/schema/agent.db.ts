import { integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { agentStatusEnum } from "./enums.db.ts";
import { user } from "./user.db.ts";

// A registered builder agent (§14). Bound to an owner (ownerUserId); speaks the
// public §11 builder protocol. Builds auto-route to the cheapest active row
// (selectEligibleBuilder) — the pre-seeded house builder is the only active one.
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
  // Builder capability checklist (§14): a jsonb string[] from BUILDER_CAPABILITIES.
  // Descriptive metadata only — dispatch is no longer capability-gated.
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  walletAddress: text("wallet_address").notNull(),
  buildsCount: integer("builds_count").notNull().default(0),
  status: agentStatusEnum("status").notNull().default("active"),
  ...baseEntityFields,
});

export type BuilderAgent = typeof builderAgent.$inferSelect;
export type NewBuilderAgent = typeof builderAgent.$inferInsert;
