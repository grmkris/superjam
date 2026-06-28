#!/usr/bin/env bun
// Hard-purge a FIXED allowlist of test/archive jams from the dev DB — the app row
// plus every child row (FK constraints are NO ACTION, so nothing cascades) — and
// tear down each one's Vercel project. Recon by default; RUN=1 to apply. Mirrors
// cleanup-jams.ts. The allowlist is hardcoded + cross-checked against a KEEP guard
// so the script can only ever touch the 10 jams the user approved.
//
//   recon: DEV_DB_URL=<dev postgres public url> bun packages/api/scripts/remove-test-jams.ts
//   apply: DEV_DB_URL=<dev postgres public url> RUN=1 bun packages/api/scripts/remove-test-jams.ts
import { projectNameFor } from "@superjam/builder/deploy";
import { createDb, schema } from "@superjam/db";
import { inArray } from "drizzle-orm";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}
const RUN = process.env.RUN === "1";

// EXACT allowlist (user-approved). The script NEVER deletes by status/query alone.
// Curate Discover to a viral showcase: drop the utility/crypto/hackathon jams.
const REMOVE_SLUGS = [
  // Dropped when the showcase moved to one-jam-per-archetype (redundant: 2nd AI-rate,
  // 2nd poll, 2nd tap-game).
  "mascot-draw-off",
  "proof-of-human-poll",
  "gem-clicker",
];
// The 10-jam showcase catalog that must NEVER be deleted (defense-in-depth guard).
const KEEP_SLUGS = [
  "roast-my-bags",
  "world-cup-trivia",
  "pineapple-pizza-poll",
  "reflex-rush",
  "japan-itinerary",
  "which-ai-are-you",
  "snack-tier-list",
  "daily-word-streak",
  "confessions-wall",
  "coin-flip-duel",
];

// The two lists MUST be disjoint — a typo that lands a keeper in REMOVE would purge it.
const overlap = REMOVE_SLUGS.filter((s) => KEEP_SLUGS.includes(s));
if (overlap.length) {
  console.error(`ABORT: REMOVE/KEEP overlap: ${overlap.join(", ")}`);
  process.exit(2);
}

const {
  app, appCounter, appLike, appMessage, appRecord, appReview, appStorage,
  build, buildDraft, pot, potStake, directMessage, publishPayment,
} = schema;
const { db, pool } = createDb(DEV_DB_URL);

// --- resolve targets by slug ---
const targets = await db
  .select({ id: app.id, slug: app.slug, status: app.status, entryUrl: app.entryUrl })
  .from(app)
  .where(inArray(app.slug, [...REMOVE_SLUGS]));

console.log(`remove-test-jams recon — ${targets.length}/${REMOVE_SLUGS.length} targets resolved:`);
for (const t of targets) {
  console.log(`  - ${t.slug.padEnd(26)} ${String(t.status).padEnd(9)} ${t.entryUrl ? "deployed" : "no-url"}  ${t.id}`);
}

// Safety: a resolved target may never be a KEEP slug; warn on slugs already gone.
const foundSlugs = new Set(targets.map((t) => t.slug));
const missing = REMOVE_SLUGS.filter((s) => !foundSlugs.has(s));
if (missing.length) {
  console.log(`\n  NOTE: ${missing.length} slug(s) already absent: ${missing.join(", ")}`);
}
const keeperHit = targets.filter((t) => KEEP_SLUGS.includes(t.slug));
if (keeperHit.length) {
  console.error(`\nABORT: a KEEP slug resolved as a target: ${keeperHit.map((t) => t.slug).join(", ")}`);
  await pool.end();
  process.exit(1);
}
if (targets.length === 0) {
  console.log("\nnothing to remove.");
  await pool.end();
  process.exit(0);
}

const ids = targets.map((t) => t.id);

// --- recon: child-row counts that will be deleted ---
const cnt = async (
  tbl: typeof appLike | typeof appCounter | typeof appReview | typeof appRecord
    | typeof appStorage | typeof appMessage | typeof build | typeof directMessage
    | typeof pot | typeof publishPayment,
  col: "appId" | "viaAppId"
): Promise<number> =>
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous tables, one-off script
  (await db.select({ x: (tbl as any)[col] }).from(tbl as any).where(inArray((tbl as any)[col], ids))).length;

console.log("\nchild rows to delete:");
console.log(
  `  like=${await cnt(appLike, "appId")} counter=${await cnt(appCounter, "appId")} ` +
  `review=${await cnt(appReview, "appId")} record=${await cnt(appRecord, "appId")} ` +
  `storage=${await cnt(appStorage, "appId")} message=${await cnt(appMessage, "appId")} ` +
  `build=${await cnt(build, "appId")} dm_via=${await cnt(directMessage, "viaAppId")} ` +
  `pot=${await cnt(pot, "appId")} publish_payment=${await cnt(publishPayment, "appId")}`
);

if (!RUN) {
  console.log("\nRECON only — set RUN=1 to apply.");
  await pool.end();
  process.exit(0);
}

// --- apply: delete child rows in FK order, then the app, in ONE transaction ---
const buildIds = (await db.select({ id: build.id }).from(build).where(inArray(build.appId, ids))).map((r) => r.id);
const potIds = (await db.select({ id: pot.id }).from(pot).where(inArray(pot.appId, ids))).map((r) => r.id);

await db.transaction(async (tx) => {
  // app.current_build_id ↔ build.app_id is a circular FK (both NO ACTION); break the
  // app→build edge before deleting builds, or the build delete trips the constraint.
  await tx.update(app).set({ currentBuildId: null }).where(inArray(app.id, ids));
  await tx.delete(directMessage).where(inArray(directMessage.viaAppId, ids));
  await tx.delete(appCounter).where(inArray(appCounter.appId, ids));
  await tx.delete(appLike).where(inArray(appLike.appId, ids));
  await tx.delete(appMessage).where(inArray(appMessage.appId, ids));
  await tx.delete(appRecord).where(inArray(appRecord.appId, ids));
  await tx.delete(appReview).where(inArray(appReview.appId, ids));
  await tx.delete(appStorage).where(inArray(appStorage.appId, ids));
  await tx.delete(publishPayment).where(inArray(publishPayment.appId, ids));
  if (potIds.length) await tx.delete(potStake).where(inArray(potStake.potId, potIds));
  await tx.delete(pot).where(inArray(pot.appId, ids));
  if (buildIds.length) await tx.delete(buildDraft).where(inArray(buildDraft.buildId, buildIds));
  await tx.delete(build).where(inArray(build.appId, ids));
  await tx.delete(app).where(inArray(app.id, ids));
});
console.log(`\ndeleted ${ids.length} apps + their child rows.`);

// --- tear down Vercel projects (best-effort; never fails the run) ---
// The real project name is EITHER the sanitized `superjam-app-<id>` (projectNameFor,
// the corrected `_`→`-` form) OR `superjam-app_<id>` (older builds Vercel created
// before the cli-deploy fix kept the underscore). Try both; first success wins.
console.log("\ntearing down Vercel projects:");
for (const t of targets) {
  const candidates = [...new Set([projectNameFor(t.id), `superjam-${t.id}`.toLowerCase()])];
  let tag = "skipped(absent)";
  let used = candidates[0] ?? "";
  for (const project of candidates) {
    const proc = Bun.spawnSync(["vercel", "remove", project, "--yes"], { stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode === 0) { tag = "removed"; used = project; break; }
    const out = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`;
    if (!/not found|doesn't exist|no project|under the scope|not exist/i.test(out)) {
      tag = "FAILED"; used = project; // a real error, not a name miss — keep trying the other form
    }
  }
  console.log(`  ${tag.padEnd(15)} ${used}`);
}
console.log("(Neon DBs not torn down — projectId isn't stored on the row; targets are zero-backend.)");

await pool.end();
console.log("\ndone.");
