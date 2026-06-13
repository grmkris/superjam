import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { app } from "./app.db.ts";
import { potStatusEnum, publishStatusEnum } from "./enums.db.ts";
import { user } from "./user.db.ts";

// Public-rail receipt for the 1 USDC publish fee (§15). txHash unique = replay
// guard; the platform verifies the Transfer log before flipping status.
export const publishPayment = pgTable("publish_payment", {
  id: typeIdPk("publishPayment"),
  appId: typeId("app", "app_id")
    .notNull()
    .references(() => app.id),
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id),
  txHash: text("tx_hash").notNull().unique(),
  chainId: integer("chain_id").notNull(),
  amountUsdc: text("amount_usdc").notNull(),
  status: publishStatusEnum("status").notNull().default("pending"),
  ...baseEntityFields,
});

// Escrowed social wager (sdk.pot, §9). Escrow custodian = the agent server
// wallet. resolver:"ai" pots are swept by the platform (§11).
export const pot = pgTable("pot", {
  id: typeIdPk("pot"),
  appId: typeId("app", "app_id")
    .notNull()
    .references(() => app.id),
  creatorUserId: typeId("user", "creator_user_id")
    .notNull()
    .references(() => user.id),
  question: text("question").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  status: potStatusEnum("status").notNull().default("open"),
  resolvedOption: text("resolved_option"),
  deadline: timestamp("deadline", { withTimezone: true, mode: "date" }),
  ...baseEntityFields,
});

// A stake on one pot option. paidOutTxHash gates idempotent pro-rata payout
// across retries/sweeps (§9).
export const potStake = pgTable("pot_stake", {
  id: typeIdPk("potStake"),
  potId: typeId("pot", "pot_id")
    .notNull()
    .references(() => pot.id),
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id),
  option: text("option").notNull(),
  amountUsdc: text("amount_usdc").notNull(),
  txHash: text("tx_hash").notNull().unique(),
  paidOutTxHash: text("paid_out_tx_hash"),
  ...baseEntityFields,
});

export type PublishPayment = typeof publishPayment.$inferSelect;
export type Pot = typeof pot.$inferSelect;
export type PotStake = typeof potStake.$inferSelect;
