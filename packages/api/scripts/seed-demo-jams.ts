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
import type { AppManifest } from "@superjam/shared";
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
const JAMS: { manifest: AppManifest; entryUrl: string }[] = [
  {
    manifest: { name: "Guestbook", slug: "guestbook", description: "A shared guestbook — sign in, leave a message, tip the author in USDC.", iconEmoji: "📖", category: "social", capabilities: ["payments"] },
    entryUrl: "https://sj-guestbook.vercel.app",
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

  const existing = await db.query.app.findMany({ columns: { slug: true } });
  const have = new Set(existing.map((a) => a.slug));
  console.log(`existing apps (${existing.length}): ${[...have].join(", ") || "(none)"}`);
  console.log("\nwould seed:");
  for (const j of JAMS) {
    const ens = `${j.manifest.slug}.${OWNER}.superjam.eth`;
    console.log(`  ${have.has(j.manifest.slug) ? "skip (exists)" : "NEW          "} ${j.manifest.slug.padEnd(20)} → ${j.entryUrl}  (${ens})`);
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
  for (const j of JAMS) {
    if (have.has(j.manifest.slug)) {
      console.log(`  ⏭  ${j.manifest.slug} exists — skipping`);
      continue;
    }
    const row = await createExternalApp(
      db,
      { manifest: j.manifest, entryUrl: j.entryUrl, ownerUserId: owner.id },
      undefined, // no onchain — names already live on-chain; set ens_name below
      logger
    );
    const ensName = `${row.slug}.${OWNER}.superjam.eth`;
    await db.update(schema.app).set({ ensName }).where(eq(schema.app.id, row.id));
    console.log(`  ✅ ${row.slug.padEnd(20)} ${row.status}  ${ensName}`);
  }
  console.log("\ndone.");
} finally {
  await pool.end();
}
