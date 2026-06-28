#!/usr/bin/env bun
// One-off cleanup for the /me "YOUR JAMS" junk:
//   1. orphaned builds stuck non-terminal (poller died on a redeploy) → failed
//   2. the stuck "building" apps they leave behind → delisted (soft, keeps ENS)
//   3. abandoned spec-less wizard drafts (never reached a plan) → deleted
// Recon (no writes) by default; RUN=1 to apply. Optional USER_ID to scope to one owner.
//
//   recon:  DEV_DB_URL=<url> bun packages/api/scripts/cleanup-jams.ts
//   write:  DEV_DB_URL=<url> RUN=1 bun packages/api/scripts/cleanup-jams.ts
//   scope:  USER_ID=user_… DEV_DB_URL=<url> RUN=1 bun packages/api/scripts/cleanup-jams.ts
import { createDb, schema } from "@superjam/db";
import { STALE_BUILD_MS, type UserId } from "@superjam/shared";
import { and, eq, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import { reapStaleBuilds } from "../src/lib/reap-builds.ts";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}
const RUN = process.env.RUN === "1";
const userId = process.env.USER_ID as UserId | undefined;

const { app, build, buildDraft } = schema;
const { db, pool } = createDb(DEV_DB_URL);

const cutoff = new Date(Date.now() - STALE_BUILD_MS);
// Reap only quiet builds (STALE_BUILD_MS) so an actively-building jam is spared.
const staleBuildWhere = and(
  notInArray(build.status, ["done", "failed"]),
  lt(build.updatedAt, cutoff),
  ...(userId ? [eq(build.userId, userId)] : [])
);
// A "building" app with no in-progress build (none, or a failed one) is junk.
const stuckAppWhere = and(
  eq(app.status, "building"),
  or(isNull(app.currentBuildId), eq(build.status, "failed")),
  ...(userId ? [eq(app.ownerUserId, userId)] : [])
);
const junkDraftWhere = and(
  isNull(buildDraft.spec),
  isNull(buildDraft.buildId),
  ...(userId ? [eq(buildDraft.userId, userId)] : [])
);

// --- recon ---
const staleBuilds = await db.select({ id: build.id }).from(build).where(staleBuildWhere);
const junkDrafts = await db
  .select({ id: buildDraft.id, prompt: buildDraft.prompt })
  .from(buildDraft)
  .where(junkDraftWhere);
console.log(`${userId ? `[user ${userId}] ` : ""}cleanup recon:`);
console.log(`  stale non-terminal builds → failed:   ${staleBuilds.length}`);
console.log(`  abandoned spec-less drafts → deleted:  ${junkDrafts.length}`);

if (!RUN) {
  // stuck-app count is approximate pre-reap (more qualify once builds flip failed)
  console.log("\nRECON only — set RUN=1 to apply.");
  await pool.end();
  process.exit(0);
}

// --- apply (order matters: reap first so orphaned builds are 'failed' before we
//     delist apps that key off build.status) ---
const reaped = await reapStaleBuilds(db, { userId, olderThanMs: STALE_BUILD_MS });
console.log(`reaped builds → failed: ${reaped}`);

const toDelist = await db
  .select({ id: app.id, slug: app.slug, name: app.name })
  .from(app)
  .leftJoin(build, eq(app.currentBuildId, build.id))
  .where(stuckAppWhere);
if (toDelist.length > 0) {
  await db
    .update(app)
    .set({ status: "delisted" })
    .where(inArray(app.id, toDelist.map((a) => a.id)));
}
console.log(`delisted stuck apps: ${toDelist.length}`);
toDelist.forEach((a) => console.log(`  - ${a.name} (${a.slug})`));

const deletedDrafts = await db
  .delete(buildDraft)
  .where(junkDraftWhere)
  .returning({ id: buildDraft.id });
console.log(`deleted abandoned drafts: ${deletedDrafts.length}`);

await pool.end();
console.log("done.");
