import type {
  AppManifest,
  AppSpec,
  BuildEvent,
  Capability,
  DraftState,
} from "@superjam/shared";
import {
  type AnyPgColumn,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import {
  appStatusEnum,
  buildStatusEnum,
  categoryEnum,
} from "./enums.db.ts";
import { user } from "./user.db.ts";

// A jam. Mints under its owner's user node (appslug.username.superjam.eth, §11);
// every remix is a NEW row with remixOfAppId lineage. ensName/ensTxHash null
// until the mint lands (a mint failure never fails a build, §11 step 5).
export const app = pgTable("app", {
  id: typeIdPk("app"),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  iconEmoji: text("icon_emoji").notNull().default("🟡"),
  category: categoryEnum("category").notNull().default("other"),
  remixOfAppId: typeId("app", "remix_of_app_id").references(
    (): AnyPgColumn => app.id
  ),
  ownerUserId: typeId("user", "owner_user_id")
    .notNull()
    .references(() => user.id),
  status: appStatusEnum("status").notNull().default("building"),
  capabilities: jsonb("capabilities").$type<Capability[]>().notNull().default([]),
  // Pivot §2: apps are external, developer/builder-hosted. The iframe loads
  // entryUrl; entryOrigin (scheme+host+port) keys the per-page frame-src CSP +
  // the optional bridge origin-pin. Non-null required at registration.
  entryUrl: text("entry_url"),
  entryOrigin: text("entry_origin"),
  /** @deprecated pivot §2 — static bundles dropped; left nullable, stop writing. */
  bundleKey: text("bundle_key"),
  version: integer("version").notNull().default(1),
  treasuryAddress: text("treasury_address"),
  ensName: text("ens_name"),
  ensTxHash: text("ens_tx_hash"),
  // Onchain games (§ builder-deploys-contracts): the bespoke Arc contract the
  // builder deployed for this jam. sdk.onchain.read/write resolve THIS address
  // (the bridge pins writes to it so a jam can't make the operator wallet sign
  // against any other contract); the ABI lets the bridge encode/decode calls.
  // Null for non-onchain jams.
  gameContractAddress: text("game_contract_address"),
  gameContractAbi: jsonb("game_contract_abi").$type<readonly unknown[]>(),
  /** @deprecated pivot §2 — IPFS pinning dropped; left nullable, stop writing. */
  ipfsCid: text("ipfs_cid"),
  currentBuildId: typeId("build", "current_build_id"),
  ...baseEntityFields,
});

// One make attempt (also iterate/remix). spec = the refined AppSpec; files =
// path→source snapshot (feeds iterate/remix + a view-source tab).
export const build = pgTable("build", {
  id: typeIdPk("build"),
  appId: typeId("app", "app_id").references(() => app.id),
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id),
  prompt: text("prompt").notNull(),
  spec: jsonb("spec").$type<AppSpec>(),
  status: buildStatusEnum("status").notNull().default("queued"),
  error: text("error"),
  files: jsonb("files").$type<Record<string, string>>(),
  events: jsonb("events").$type<BuildEvent[]>().notNull().default([]),
  manifest: jsonb("manifest").$type<AppManifest>(),
  model: text("model"),
  durationMs: integer("duration_ms"),
  costUsd: text("cost_usd"),
  // The USDC receipt that paid for this build (a paid marketplace agent, §14).
  // UNIQUE → one receipt can't fund two builds (replay guard, mirrors
  // publishPayment). Null for free / house-builder builds.
  paymentTxHash: text("payment_tx_hash").unique(),
  ...baseEntityFields,
});

// A resumable make-flow draft (§3c) — the wizard persisted from prompt-start so a
// reload/redirect resumes instead of resetting. The CLIENT generates the id (typeid)
// so the URL (/build?d=…) is stable from mount; `step`+`prompt`+`spec` are queryable,
// `state` is the rest of the wizard blob. `buildId` is set on dispatch (builds.create)
// → the draft leaves the "pending" feed and the build/app takes over. Owned by userId.
export const buildDraft = pgTable("build_draft", {
  id: typeIdPk("buildDraft"),
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id),
  step: text("step").notNull().default("home"),
  prompt: text("prompt").notNull().default(""),
  spec: jsonb("spec").$type<AppSpec>(),
  state: jsonb("state").$type<DraftState>().notNull().default({}),
  buildId: typeId("build", "build_id").references(() => build.id),
  ...baseEntityFields,
});

export type App = typeof app.$inferSelect;
export type NewApp = typeof app.$inferInsert;
export type Build = typeof build.$inferSelect;
export type NewBuild = typeof build.$inferInsert;
export type BuildDraft = typeof buildDraft.$inferSelect;
export type NewBuildDraft = typeof buildDraft.$inferInsert;
