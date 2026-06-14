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
import { eq } from "drizzle-orm";
import type { AppManifest, AppSpec } from "@superjam/shared";
import {
  allocateExternalApp,
  finalizeExternalApp,
} from "../src/routers/apps.ts";

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
  {
    name: "Trip Guide",
    slug: "trip-guide",
    description:
      "Describe a trip in plain words and get a day-by-day itinerary plotted on a real map — markers, a route, and a postcard for every stop.",
    iconEmoji: "🧭",
    category: "other",
    capabilities: ["ai"],
    features: [
      "The player types a trip request; sdk.ai.chat returns a day-by-day itinerary as JSON with real lat/lng per stop (loading state + a hard-coded fallback itinerary if the AI is slow or returns junk).",
      "Stops render on the seeded interactive map (components/trip-map.tsx, MapLibre) as day-coloured numbered markers joined by a dashed route line, auto-fit to the trip.",
      "Each stop shows a postcard image baked per vibe category (city/beach/mountains/countryside/food/culture) with an emoji fallback if image generation is unavailable.",
      "Save the last itinerary to per-user storage and restore it on open; Share copies a deep link that reopens the trip read-only (via ctx.launch).",
      "A community ‘Top destinations’ leaderboard counts trips per country (sdk.data.counter).",
    ],
    data: {
      collections: [],
      counters: [
        { name: "destinations", keyedBy: "country", meaning: "how many trips the community has planned to each country" },
      ],
      storage: [{ key: "trip", meaning: "the player's most recently planned itinerary" }],
    },
    ai: { uses: ["plan a day-by-day trip itinerary as JSON with stop coordinates"] },
    ui: {
      layout: "single card: a trip prompt + Plan button, the map, a list of stop cards with postcards, then a destinations leaderboard",
      sections: ["trip-prompt", "map", "stop-cards", "leaderboard"],
    },
    skills: ["map", "art"],
    acceptance: [
      "Entering a prompt and tapping Plan calls sdk.ai.chat, shows a loading state, and renders an itinerary; on AI error/junk a sensible fallback itinerary renders instead.",
      "Stops appear on the seeded <TripMap> as numbered, day-coloured markers with a route line connecting them in visit order, auto-fit to the trip.",
      "AI coordinates are validated (finite, in-range) before plotting; invalid stops are dropped and the map is never empty.",
      "Each stop card shows a postcard for its category (baked via generate_image) or an emoji fallback — never a broken image.",
      "The trip saves to storage and restores on reopen; Share copies a link that reopens the same trip from ctx.launch.",
      "Planning a trip increments counter('destinations') for the country and the leaderboard shows the top places.",
      "Works in standalone mode (degrades the AI plan to the fallback gracefully).",
    ],
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const manifestOf = (s: AppSpec): AppManifest => ({
  name: s.name,
  slug: s.slug,
  description: s.description,
  iconEmoji: s.iconEmoji,
  category: s.category,
  capabilities: s.capabilities,
});

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
    const allocated = await allocateExternalApp(db, {
      manifest: manifestOf(spec),
      ownerUserId: owner.id,
    });
    const appId = allocated.id;
    console.log(`   allocated appId=${appId} (status=building)`);
    try {
      // 2+3) build via the agentic builder + poll to done.
      const entryUrl = await runBuild(spec, appId);
      // 4) finalize: attach the live URL + list it. No onchain here — ENS is
      // minted separately (mint-jam-ens.ts); the platform builds.create path
      // passes onchain so production builds name themselves.
      const row = await finalizeExternalApp(db, { appId, entryUrl });
      console.log(`   ✅ ${row.slug} → ${entryUrl}  (status=${row.status})`);
    } catch (e) {
      console.log(`   ✗ build failed: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`     (app row ${appId} left status=building — re-run or clean up)`);
    }
  }
  console.log("\ndone.");
} finally {
  await pool.end();
}
