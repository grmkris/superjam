import { text, timestamp } from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { pgTable } from "drizzle-orm/pg-core";
import { user } from "./user.db.ts";

// Personal Access Token (§MCP) — a long-lived bearer the user mints to authorize
// an external agent (their Claude Code, via the SuperJam MCP) to act AS them. The
// raw token (`sjat_<random>`) is shown ONCE; we store only its SHA-256 hash. The
// auth middleware resolves a `sjat_` bearer → this row → the owning user, so every
// protected procedure transparently accepts a PAT (no per-procedure change). The
// agent then builds + pays via the user's Dynamic-delegated wallet.
export const userToken = pgTable("user_token", {
  id: typeIdPk("userToken"),
  /** The owner — the PAT acts entirely as this user. */
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id),
  /** A human label (e.g. "Claude Code on my laptop"). */
  name: text("name").notNull(),
  /** SHA-256 hex of the raw `sjat_…` token. The raw token is never stored. */
  tokenHash: text("token_hash").notNull().unique(),
  /** First chars of the raw token, for UI display (e.g. `sjat_a1b2…`). */
  tokenPreview: text("token_preview").notNull(),
  /** Optional expiry; null ⇒ never expires (revoke by deleting the row). */
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  /** Last time the token authenticated a request (best-effort touch). */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  ...baseEntityFields,
});

export type UserToken = typeof userToken.$inferSelect;
export type NewUserToken = typeof userToken.$inferInsert;
