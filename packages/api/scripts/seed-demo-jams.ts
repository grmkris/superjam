#!/usr/bin/env bun
// Re-seed the 6 demo jams into a live DB after a wipe. The jams are ALREADY
// deployed on Vercel and ALREADY named on-chain (ENSv2 nested
// `<slug>.<owner>.superjam.eth`, resolvable in standard tooling) — a DB wipe
// touches neither — so this only re-creates the `app` rows + restores ens_name.
// No rebuild, no redeploy, no ENS re-mint. Mirrors register-direct.ts.
//
//   recon (no writes):  DEV_DB_URL=<url> bun packages/api/scripts/seed-demo-jams.ts
//   seed:               DEV_DB_URL=<url> OWNER=kristjangrm1 RUN=1 bun packages/api/scripts/seed-demo-jams.ts
import { createDb, schema } from "@superjam/db";
import { eq } from "drizzle-orm";
import type { AppId, AppManifest } from "@superjam/shared";
import { createExternalApp } from "../src/routers/apps.ts";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}
const OWNER = process.env.OWNER ?? "kristjangrm1";

// The 6 demo jams — manifest + the live Vercel URL + the live nested ENS name.
// ensName is set under OWNER (`<slug>.<OWNER>.superjam.eth`); the on-chain name
// already resolves (minted earlier), so we just record it in the DB.
//
// `id` PINS the app's DB id to the one the deployed app already bakes as
// SUPERJAM_APP_ID (the token audience). Only apps with their OWN backend that
// VERIFIES the platform token need it (Guestbook is the only demo that does —
// the rest use host-bridge SDK primitives and never check `aud`). Without the
// pin, a DB wipe + re-seed mints a fresh id → the deployed app rejects every
// token (401 "identity check failed"). Recover an id from the deployed app's
// Vercel SUPERJAM_APP_ID (or probe-deployed-app.ts) before pinning a new one.
const JAMS: { manifest: AppManifest; entryUrl: string; id?: AppId }[] = [
  {
    manifest: { name: "Guestbook", slug: "guestbook", description: "A shared guestbook — sign in, leave a message, tip the author in USDC.", iconEmoji: "📖", category: "social", capabilities: ["payments"] },
    entryUrl: "https://sj-guestbook.vercel.app",
    id: "app_01kv09wp8vfzs9t0a1aswf1pa3" as AppId,
  },
  {
    manifest: { name: "Tip Jar", slug: "tip-jar", description: "Send the maker a private USDC tip and climb the tippers leaderboard.", iconEmoji: "🫙", category: "tool", capabilities: ["payments"] },
    entryUrl: "https://superjam-demo-tipjar.vercel.app",
  },
  {
    manifest: { name: "World Cup Trivia", slug: "world-cup-trivia", description: "A fast World Cup trivia quiz with a per-question timer and a verified-human leaderboard.", iconEmoji: "🧠", category: "game", capabilities: ["ai"] },
    entryUrl: "https://superjam-demo-world-cup-trivia.vercel.app",
  },
  {
    manifest: { name: "Final Pot", slug: "final-pot-demo", description: "Stake USDC on who wins the final; it auto-resolves and winners split the pot.", iconEmoji: "⚽", category: "game", capabilities: ["payments"] },
    entryUrl: "https://superjam-demo-final-pot-demo.vercel.app",
  },
  {
    manifest: { name: "Mascot Draw-off", slug: "mascot-draw-off", description: "Draw the team mascot; an AI judge scores it on creativity and ranks the gallery.", iconEmoji: "🎨", category: "creative", capabilities: ["ai"] },
    entryUrl: "https://superjam-demo-mascot-draw-off.vercel.app",
  },
  {
    manifest: { name: "Spending Explainer", slug: "spending-explainer", description: "Drop a CSV of expenses and an AI explains what stands out, with a chart.", iconEmoji: "📊", category: "tool", capabilities: ["ai"] },
    entryUrl: "https://superjam-demo-spending-explainer.vercel.app",
  },
];

const { db, pool } = createDb(DEV_DB_URL);
const logger = {
  warn: (o: unknown, m: string) => console.log("[warn]", m, o),
  info: () => {},
  error: (o: unknown, m: string) => console.log("[error]", m, o),
  debug: () => {},
  child: () => logger,
} as never;

try {
  const users = await db.query.user.findMany({
    columns: { id: true, username: true, walletAddress: true },
    limit: 50,
  });
  const owner = users.find((u) => u.username === OWNER);
  console.log(`\nowner → ${owner ? `${owner.username} (${owner.id}) wallet=${owner.walletAddress ?? "(none)"}` : `NONE (looked for "${OWNER}")`}`);

  const existing = await db.query.app.findMany({ columns: { slug: true, id: true } });
  const idBySlug = new Map(existing.map((a) => [a.slug, a.id]));
  console.log(`existing apps (${existing.length}): ${[...idBySlug.keys()].join(", ") || "(none)"}`);

  // Decide an action per jam: NEW (absent), SKIP (present, id already correct or
  // no pin), or FIX-ID (present but its id ≠ the pinned SUPERJAM_APP_ID — re-point
  // the PK so the deployed app's token audience matches again).
  type Action = "NEW" | "SKIP" | "FIX-ID";
  const plan = JAMS.map((j) => {
    const curId = idBySlug.get(j.manifest.slug);
    const action: Action = !curId
      ? "NEW"
      : j.id && curId !== j.id
        ? "FIX-ID"
        : "SKIP";
    return { j, curId, action };
  });
  console.log("\nwould seed:");
  for (const { j, curId, action } of plan) {
    const ens = `${j.manifest.slug}.${OWNER}.superjam.eth`;
    const detail = action === "FIX-ID" ? ` (${curId} → ${j.id})` : "";
    console.log(`  ${action.padEnd(7)} ${j.manifest.slug.padEnd(20)} → ${j.entryUrl}  (${ens})${detail}`);
  }

  if (process.env.RUN !== "1") {
    console.log("\n(recon only — set RUN=1 [OWNER=<username>] to seed)");
    process.exit(0);
  }
  if (!owner) {
    console.error(`\nowner "${OWNER}" not found — cannot seed`);
    process.exit(1);
  }

  console.log("\nseeding…");
  for (const { j, curId, action } of plan) {
    if (action === "SKIP") {
      console.log(`  ⏭  ${j.manifest.slug} exists — skipping`);
      continue;
    }
    if (action === "FIX-ID") {
      // Re-point the existing row's PK to the pinned id. Safe for the demo seed:
      // these rows have no build/payment/like children referencing app.id yet.
      await db.update(schema.app).set({ id: j.id }).where(eq(schema.app.id, curId!));
      console.log(`  🔧 ${j.manifest.slug.padEnd(20)} id ${curId} → ${j.id}`);
      continue;
    }
    const row = await createExternalApp(
      db,
      { manifest: j.manifest, entryUrl: j.entryUrl, ownerUserId: owner.id, id: j.id },
      undefined, // no onchain — names already live on-chain; set ens_name below
      logger
    );
    const ensName = `${row.slug}.${OWNER}.superjam.eth`;
    await db.update(schema.app).set({ ensName }).where(eq(schema.app.id, row.id));
    console.log(`  ✅ ${row.slug.padEnd(20)} ${row.status}  ${ensName}  id=${row.id}`);
  }
  console.log("\ndone.");
} finally {
  await pool.end();
}
