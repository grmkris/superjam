#!/usr/bin/env bun
// Build NEW demo jams through the REAL agentic builder (apps/builder), then
// register them — the same allocate→deploy→finalize the platform's builds.create
// runs, minus the auth/payment/refine wrapper (so it's headless from the box).
//
// Per jam: allocate the app row (→ real appId, baked into the app as the JWT
// audience) → POST the spec to the builder (it spins a Claude agent that codes +
// `vercel deploy`s) → poll to done → finalize (entryUrl + status=listed). The
// builder bakes SUPERJAM_JWKS_URL=dev, so the apps verify against dev's JWKS.
//
//   recon (no writes):  DEV_DB_URL=… BUILDER_URL=… BUILDER_TOKEN=… bun packages/api/scripts/build-demo-jams.ts
//   build:              … RUN=1 [ONLY=reflex-rush] bun packages/api/scripts/build-demo-jams.ts
import { createDb, schema } from "@superjam/db";
import { eq, sql } from "drizzle-orm";
import type { AppSpec } from "@superjam/shared";
import { typeIdGenerator, typeIdToUuid } from "@superjam/shared/typeid";

// NOTE: we allocate/finalize the app row with RAW SQL (not the apps-router
// Drizzle helpers) on purpose. A parallel lane has app.db.ts edited in the
// working tree with new columns (game_contract_*, built_by_agent_id) that the
// dev DB hasn't migrated yet, so any full-schema INSERT / `returning *` errors
// against dev. Raw SQL touching only the columns that exist keeps us isolated
// from that in-flight migration.

const DEV_DB_URL = process.env.DEV_DB_URL;
const BUILDER_URL = process.env.BUILDER_URL;
const BUILDER_TOKEN = process.env.BUILDER_TOKEN;
if (!DEV_DB_URL || !BUILDER_URL || !BUILDER_TOKEN) {
  console.error("set DEV_DB_URL, BUILDER_URL, BUILDER_TOKEN");
  process.exit(2);
}
const OWNER = process.env.OWNER ?? "kristjangrm1";
const ONLY = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60_000);

// ─── The three jams ──────────────────────────────────────────────────────────
const SPECS: AppSpec[] = [
  {
    name: "What-If Calculator",
    slug: "what-if-calc",
    description:
      "Crunch a loan, a savings goal, a tip split, or a currency convert — then get a plain-English read on what it means.",
    iconEmoji: "🧮",
    category: "tool",
    capabilities: ["ai"],
    features: [
      "Four modes: loan monthly payment, savings-goal timeline, tip splitter, and currency convert (the user types the rate).",
      "Numbers recompute instantly as you type — no submit button.",
      "‘Explain this’ asks the AI to describe the result in two plain-English sentences, with a loading state and a graceful canned fallback if the AI is slow or returns junk.",
      "Save the current scenario and reload it later (per-user storage).",
      "Share a scenario as a link that reopens the calculator pre-filled (via ctx.launch).",
    ],
    data: {
      collections: [],
      counters: [],
      storage: [
        { key: "scenarios", meaning: "the user's saved calculator scenarios (mode + inputs)" },
      ],
    },
    ai: { uses: ["explain a computed financial result in two plain-English sentences"] },
    ui: {
      layout: "single column: mode tabs, inputs, a big result, then an Explain + Save + Share row",
      sections: ["mode-tabs", "inputs", "result", "explanation", "actions"],
    },
    skills: [],
    acceptance: [
      "All four modes compute correct numbers live as inputs change.",
      "‘Explain’ calls sdk.ai.chat, shows a loading state, and renders a short explanation; if the AI errors or returns junk, a sensible canned explanation is shown instead.",
      "Saving a scenario then reloading the app restores it from storage.",
      "Opening a shared link pre-fills the matching mode + inputs from ctx.launch.",
      "Works in standalone mode (degrades the AI explanation gracefully).",
    ],
  },
  {
    name: "Locked Notes",
    slug: "locked-notes",
    description:
      "Jot private notes, then publish one behind a small USDC unlock — readers pay to read. AI tidies your draft on demand.",
    iconEmoji: "🔒",
    category: "tool",
    capabilities: ["payments", "ai"],
    features: [
      "Write a note; the draft autosaves privately as you type (per-user storage).",
      "‘Tidy up’ rewrites/cleans the current draft via AI (loading state + fallback to the original text).",
      "Publish a note with a title and a price; it appears in a shared feed of published notes (sdk.data.collection).",
      "Other users see a published note's title but a LOCKED body; tapping ‘Unlock — $0.25’ runs a USDC payment, then reveals the body.",
      "Unlock is verified via payments.mine() (the trustworthy paywall check), so a paid note stays unlocked on return.",
    ],
    data: {
      collections: [],
      counters: [],
      storage: [{ key: "draft", meaning: "the user's current private note draft" }],
    },
    payments: { actions: [{ label: "Unlock note", amountUsdc: "0.25", to: "appTreasury" }] },
    ai: { uses: ["tidy up and lightly summarize a note draft"] },
    ui: {
      layout: "single column: an editor with Tidy/Publish, then a feed of published notes with locked bodies",
      sections: ["editor", "publish-form", "notes-feed"],
    },
    skills: [],
    acceptance: [
      "Typing a draft autosaves to storage and survives a reload.",
      "‘Tidy up’ calls sdk.ai.chat and replaces the draft with the cleaned text; on AI error it leaves the draft unchanged and toasts a friendly message.",
      "Publishing adds the note to a shared collection (title + body + price) and it shows in the feed for everyone.",
      "A published note shows its title but hides its body until the viewer taps Unlock; Unlock runs sdk.payments.payUSDC and, once payments.mine() confirms a payment in this app, reveals the body.",
      "This is intentionally a SOFT/client-side paywall (the body lives in the shared collection) — fine for a demo, not a vault. Render all note text as plain text.",
      "Standalone mode shows an ‘open in SuperJam to publish/pay’ state instead of erroring.",
    ],
  },
  {
    name: "Reflex Rush",
    slug: "reflex-rush",
    description:
      "Tap the targets before they vanish — faster taps score more. Beat the 30-second clock and climb the verified-human leaderboard.",
    iconEmoji: "⚡",
    category: "game",
    capabilities: [],
    features: [
      "A 30-second round: glowing targets pop up at random spots and shrink/expire; tap one before it vanishes to score.",
      "Faster taps (caught earlier) score more points; a missed target scores nothing.",
      "Live score + countdown during the round, then a snappy end screen with your score.",
      "Your best score posts to a leaderboard (sdk.data.counter), highest first, your row highlighted.",
      "Pure touch — works on a phone; emoji/CSS/canvas visuals, no external assets.",
    ],
    data: {
      collections: [],
      counters: [
        { name: "scores", keyedBy: "username", meaning: "the player's best single-round reflex score" },
      ],
      storage: [],
    },
    ui: {
      layout: "a full-screen play area with a HUD (score + timer), start + end overlays, and a leaderboard below",
      sections: ["hud", "play-area", "leaderboard"],
    },
    skills: ["game-2d"],
    acceptance: [
      "Pressing Start runs a 30-second round with a visible countdown.",
      "Targets spawn at random positions and expire after a short window; tapping a live target scores (earlier = more), a missed target does not.",
      "At the end, the final score updates counter('scores') for the user ONLY if it beats their previous best.",
      "The leaderboard shows the top ~10 (highest first) with the current user highlighted.",
      "Fully playable with touch on a phone; no keyboard required; degrades gracefully in standalone mode.",
    ],
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Dbh = ReturnType<typeof createDb>["db"];

/** Insert the app row (status=building) with a fresh appId. Raw SQL, real
 *  columns only. Returns the TypeID appId the builder bakes as SUPERJAM_APP_ID. */
const allocate = async (db: Dbh, spec: AppSpec, ownerId: string): Promise<string> => {
  const appId = typeIdGenerator("app");
  const idUuid = typeIdToUuid(appId).uuid;
  const ownerUuid = typeIdToUuid(ownerId as never).uuid;
  await db.execute(sql`
    insert into "app" (id, slug, name, description, icon_emoji, category, owner_user_id, status, capabilities)
    values (${idUuid}::uuid, ${spec.slug}, ${spec.name}, ${spec.description}, ${spec.iconEmoji},
            ${spec.category}, ${ownerUuid}::uuid, 'building', ${JSON.stringify(spec.capabilities)}::jsonb)`);
  return appId;
};

/** Attach the deployed URL + list the app. Raw SQL, real columns only. */
const finalize = async (db: Dbh, appId: string, entryUrl: string): Promise<void> => {
  const idUuid = typeIdToUuid(appId as never).uuid;
  const origin = new URL(entryUrl).origin;
  await db.execute(sql`
    update "app" set entry_url=${entryUrl}, entry_origin=${origin}, status='listed', updated_at=now()
    where id=${idUuid}::uuid`);
};

interface BuildState {
  status: "running" | "done" | "failed";
  events?: { t: number; kind: string; label?: string }[];
  result?: { entryUrl: string; vercelProject?: string; neonProjectId?: string };
  error?: string;
}

/** POST the spec to the builder, then poll until done/failed. Returns entryUrl. */
const runBuild = async (spec: AppSpec, appId: string): Promise<string> => {
  const buildId = `build_${appId}_${Date.now().toString(36)}`;
  const accept = await fetch(`${BUILDER_URL}/builds`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${BUILDER_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ spec, buildId, appId }),
  });
  if (accept.status === 429) throw new Error("builder at capacity (429)");
  if (!accept.ok) throw new Error(`builder rejected build: ${accept.status} ${await accept.text()}`);

  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  let lastLabel = "";
  for (;;) {
    if (Date.now() > deadline) throw new Error("build timed out");
    await sleep(4000);
    const res = await fetch(`${BUILDER_URL}/builds/${buildId}`, {
      headers: { authorization: `Bearer ${BUILDER_TOKEN}` },
    });
    if (!res.ok) continue;
    const state = (await res.json()) as BuildState;
    const label = state.events?.at(-1)?.label;
    if (label && label !== lastLabel) {
      lastLabel = label;
      console.log(`     · ${label}`);
    }
    if (state.status === "done" && state.result?.entryUrl) return state.result.entryUrl;
    if (state.status === "failed") throw new Error(state.error ?? "build failed");
  }
};

// ─── Main ────────────────────────────────────────────────────────────────────
const { db, pool } = createDb(DEV_DB_URL);

try {
  const owner = await db.query.user.findFirst({
    where: eq(schema.user.username, OWNER),
    columns: { id: true, username: true },
  });
  console.log(`owner → ${owner ? `${owner.username} (${owner.id})` : `NONE (looked for "${OWNER}")`}`);

  const existing = await db.query.app.findMany({ columns: { slug: true } });
  const have = new Set(existing.map((a) => a.slug));

  const todo = SPECS.filter((s) => (ONLY ? ONLY.includes(s.slug) : true));
  console.log(`\nwould build (${todo.length}):`);
  for (const s of todo) {
    console.log(`  ${have.has(s.slug) ? "skip (exists)" : "BUILD       "} ${s.iconEmoji} ${s.slug.padEnd(16)} — ${s.name}`);
  }

  if (process.env.RUN !== "1") {
    console.log("\n(recon only — set RUN=1 to build via the agentic builder)");
    process.exit(0);
  }
  if (!owner) {
    console.error(`\nowner "${OWNER}" not found — cannot build`);
    process.exit(1);
  }

  for (const spec of todo) {
    if (have.has(spec.slug)) {
      console.log(`\n⏭  ${spec.slug} exists — skipping`);
      continue;
    }
    console.log(`\n▶ ${spec.iconEmoji} ${spec.name} (${spec.slug})`);
    // 1) allocate → appId baked into the app as SUPERJAM_APP_ID (the token aud).
    const appId = await allocate(db, spec, owner.id);
    console.log(`   allocated appId=${appId} (status=building)`);
    try {
      // 2+3) build via the agentic builder + poll to done.
      const entryUrl = await runBuild(spec, appId);
      // 4) finalize: attach the live URL + list it (no onchain ENS — stays un-named).
      await finalize(db, appId, entryUrl);
      console.log(`   ✅ ${spec.slug} → ${entryUrl}  (status=listed)`);
    } catch (e) {
      console.log(`   ✗ build failed: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`     (app row ${appId} left status=building — re-run or clean up)`);
    }
  }
  console.log("\ndone.");
} finally {
  await pool.end();
}
