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
    name: "Roast Me",
    slug: "roast-my-bags",
    description:
      "Submit anything — your outfit, your desk setup, your hottest take — and a savage but wholesome AI roasts it and scores it out of 10. Then share the burn.",
    iconEmoji: "🔥",
    category: "creative",
    capabilities: ["ai"],
    features: [
      "Type or paste anything to roast (a fit, a setup, a bio, a take).",
      "The roast returns a witty one-liner plus a 0-10 score — wholesome (it roasts the THING, never the person), with a local fallback when the AI is slow or unavailable.",
      "A shareable verdict card with a 'your turn — beat my score' link via sdk.share.link.",
    ],
    data: { collections: [], counters: [], storage: [] },
    ai: { uses: ["roast a user-submitted thing in one witty wholesome line plus a 0-10 score, as JSON"] },
    ui: {
      layout: "an input box and a Roast button, then a verdict card with the score, the roast, and a share button",
      sections: ["input", "verdict", "share"],
    },
    skills: [],
    acceptance: [
      "Submitting calls sdk.ai.chat for a {score,roast} verdict, parsed defensively, with a LOCAL fallback so it always returns something.",
      "The verdict shows a 0-10 score plus a one-line roast on a card; a Share button makes a sdk.share.link.",
      "Roasts the artifact, never the person; all text rendered as plain React text.",
      "Degrades gracefully in standalone mode.",
    ],
  },
  {
    name: "World Cup Trivia",
    slug: "world-cup-trivia",
    description:
      "A fast World Cup trivia quiz — beat the per-question timer, rack up points, and top the leaderboard. Share your score and challenge a friend.",
    iconEmoji: "🧠",
    category: "game",
    capabilities: ["ai"],
    features: [
      "Snappy multiple-choice trivia questions with a per-question countdown timer.",
      "Points for correct and fast answers; a global high-score leaderboard via sdk.data.counter.",
      "A local question bank so it never blocks on the network; the AI adds fresh questions when available.",
      "At the end, a shareable 'I scored X — can you beat it?' link via sdk.share.link.",
    ],
    data: {
      collections: [],
      counters: [{ name: "scores", keyedBy: "username", meaning: "the player's best quiz score" }],
      storage: [{ key: "best", meaning: "personal best score" }],
    },
    ai: { uses: ["generate fresh trivia questions as JSON, with a local fallback bank"] },
    ui: {
      layout: "a question card with a timer and tappable options, a running score, then a leaderboard and a share button",
      sections: ["question", "score", "leaderboard"],
    },
    skills: [],
    acceptance: [
      "Questions show with a timer and options; correct/fast answers score points.",
      "The final score updates counter('scores') and the leaderboard shows the top players.",
      "A local fallback bank works with no AI; a Share link is offered at the end.",
      "Plays on a phone; degrades gracefully in standalone mode.",
    ],
  },
  {
    name: "Mascot Draw-off",
    slug: "mascot-draw-off",
    description:
      "Draw a team mascot on the canvas; an AI rates every drawing for creativity and the shared gallery shows the best ones first. Share yours to rack up reactions.",
    iconEmoji: "🎨",
    category: "creative",
    capabilities: ["ai"],
    features: [
      "A simple touch canvas to draw your mascot (emoji/CSS/canvas only, no external assets).",
      "On submit, sdk.ai.chat rates the drawing 0-10 for creativity with a one-line note, parsed defensively with a local fallback.",
      "A shared gallery (sdk.data.collection) shows everyone's drawing and its rating, best first.",
      "Share your masterpiece with a sdk.share.link.",
    ],
    data: {
      collections: [
        {
          name: "drawings",
          fields: [
            { name: "imageUrl", type: "string" },
            { name: "score", type: "number" },
          ],
          writtenWhen: "a player submits their mascot",
        },
      ],
      counters: [],
      storage: [],
    },
    ai: { uses: ["score a submitted drawing 0-10 for creativity with a short note"] },
    ui: {
      layout: "a draw canvas with a Submit button, then a gallery of scored drawings best-first, plus a share button",
      sections: ["canvas", "gallery", "share"],
    },
    skills: ["judge"],
    acceptance: [
      "A touch canvas lets the player draw and submit (uploaded via sdk.files.upload).",
      "sdk.ai.chat scores the drawing; on AI error a local fallback score keeps it working.",
      "The shared gallery lists everyone's drawing with its score, best-first; a Share link is offered.",
      "All text is plain React text; standalone-safe.",
    ],
  },
  {
    name: "Pineapple on Pizza?",
    slug: "pineapple-pizza-poll",
    description:
      "The eternal debate: does pineapple belong on pizza? Cast your vote, watch the live tally, and share the poll to settle it.",
    iconEmoji: "🍍",
    category: "social",
    capabilities: [],
    features: [
      "A simple this-or-that vote: yes or no.",
      "A live results bar showing the percentage split via sdk.data.counter.",
      "Your vote persists across reloads; share the poll to rally more votes via sdk.share.link.",
    ],
    data: {
      collections: [],
      counters: [{ name: "votes", keyedBy: "option", meaning: "tally per option" }],
      storage: [{ key: "myVote", meaning: "this voter's pick" }],
    },
    ui: {
      layout: "a question, two big vote buttons, a live result bar, and a share button",
      sections: ["question", "vote", "results"],
    },
    skills: [],
    acceptance: [
      "Voting bumps the chosen option's live bar; the pick survives a reload.",
      "The bars reflect everyone's votes; a Share link rallies more.",
      "Standalone-safe.",
    ],
  },
  {
    name: "Hot Take Poll",
    slug: "proof-of-human-poll",
    description:
      "Drop a spicy this-or-that and watch the community vote in real time. See where you land versus everyone else, then share to start an argument.",
    iconEmoji: "🗳️",
    category: "social",
    capabilities: [],
    features: [
      "Vote on a live poll; the results update instantly.",
      "See the percentage split and how your pick compares via sdk.data.counter.",
      "Share the poll with a link to pull in more votes via sdk.share.link.",
    ],
    data: {
      collections: [],
      counters: [{ name: "votes", keyedBy: "option", meaning: "tally per option" }],
      storage: [{ key: "myVote", meaning: "this voter's pick" }],
    },
    ui: {
      layout: "a question, options, live result bars, and a share button",
      sections: ["question", "options", "results"],
    },
    skills: [],
    acceptance: [
      "Voting updates the live bars; the pick persists across a reload.",
      "A Share link works; standalone-safe.",
    ],
  },
  {
    name: "Gem Clicker",
    slug: "gem-clicker",
    description:
      "Tap the gem as fast as you can before the clock runs out, then climb the global leaderboard. Share your score and challenge a friend.",
    iconEmoji: "💎",
    category: "game",
    capabilities: [],
    features: [
      "A big tappable gem; each tap scores, with a satisfying pop.",
      "A short timed round with a live score and countdown.",
      "A global high-score leaderboard via sdk.data.counter, your row highlighted.",
      "Share an 'I scored X — beat me' link via sdk.share.link.",
    ],
    data: {
      collections: [],
      counters: [{ name: "scores", keyedBy: "username", meaning: "the player's best tap score" }],
      storage: [],
    },
    ui: {
      layout: "a big gem tap target with a score and timer HUD, then a leaderboard and a share button",
      sections: ["tap-target", "hud", "leaderboard"],
    },
    skills: [],
    acceptance: [
      "Tapping the gem scores during a timed round.",
      "The best score posts to the leaderboard, highest first; a Share link is offered.",
      "Phone-friendly and standalone-safe.",
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
    name: "10 Days in Japan",
    slug: "japan-itinerary",
    description:
      "A gorgeous, hand-crafted 10-day Japan itinerary — Tokyo to Miyajima — with the route on a live map, a photo and food + transit + tips for every stop, and a guide you can ask anything.",
    iconEmoji: "🗾",
    category: "other",
    capabilities: ["ai"],
    features: [
      "A COMPLETE curated 10-day itinerary, authored at build time (NOT a planner): 7 real stops in order — Tokyo → Hakone → Kyoto → Nara → Osaka → Hiroshima → Miyajima — each with real coordinates, a vivid 2-3 sentence description, 3-5 highlights, specific food picks, how to get there (shinkansen/JR), and a practical tip.",
      "A full-width hero image + a 'trip at a glance' line (10 days · 7 stops · Tokyo → Miyajima).",
      "The route renders on the seeded interactive map (components/trip-map.tsx, MapLibre): all 7 stops as day-coloured numbered markers joined by a route line across Japan, auto-fit.",
      "A beautiful baked photo for every stop (real scenes: Senso-ji, Mt Fuji/Hakone, Fushimi Inari, Nara deer, Dotonbori, Hiroshima Peace Dome, Miyajima torii) + a hero — generated at build time (≤8 images), each with an emoji/gradient fallback so an image is never broken.",
      "An 'Ask the guide' box: sdk.ai.chat grounded in this exact itinerary answers anything about the trip (e.g. 'vegetarian food in Kyoto?') with a loading state and a graceful fallback.",
      "Polished read-first UI with plain CSS only (sticky day nav, smooth expand, image hover) — no extra dependencies. Bookmark favourite stops to per-user storage.",
    ],
    data: {
      collections: [],
      counters: [],
      storage: [{ key: "favorites", meaning: "stops the user bookmarked on the day rail" }],
    },
    ai: { uses: ["answer questions about this specific baked Japan itinerary (food, timing, transit, what to see)"] },
    ui: {
      layout: "hero image + trip-at-a-glance, the route map, then one rich card per stop (photo, highlights, food, getting-here, tip), with a sticky day rail and an ask-the-guide box",
      sections: ["hero", "trip-at-a-glance", "route map", "stop cards", "ask the guide"],
    },
    skills: ["map", "art"],
    acceptance: [
      "On open (no input, no network), the full 10-day itinerary is already there: hero, trip-at-a-glance, the map, and all 7 stop cards.",
      "<TripMap> shows all 7 stops as numbered day-coloured markers with a route line across Japan in visit order, auto-fit to the country.",
      "Each stop card has a real photo (baked via generate_image, emoji/gradient fallback), a vivid description, 3-5 highlights, 2+ specific food picks, a 'getting here' transit line, and a tip.",
      "A hero image renders at the top (with a graceful fallback).",
      "'Ask the guide' calls sdk.ai.chat with the itinerary as context, shows a loading state, and answers about the trip; on AI error it shows a friendly fallback and never blocks the page.",
      "Bookmarking a stop persists to storage and survives a reload.",
      "Polish uses plain CSS only — no motion/react or other added dependency. All text is plain React text.",
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

  // FORCE=1 → REBUILD existing slugs in place: reuse the existing appId (so the
  // SUPERJAM_APP_ID baked as the JWT audience stays stable) and re-point the row's
  // entryUrl at the fresh deploy. Without FORCE, existing slugs are skipped.
  const FORCE = process.env.FORCE === "1";
  const existing = await db.query.app.findMany({ columns: { slug: true, id: true } });
  const slugToId = new Map(existing.map((a) => [a.slug, a.id]));
  const have = new Set(existing.map((a) => a.slug));

  const todo = SPECS.filter((s) => (ONLY ? ONLY.includes(s.slug) : true));
  console.log(`\nwould build (${todo.length})${FORCE ? " [FORCE — rebuild existing in place]" : ""}:`);
  for (const s of todo) {
    const tag = have.has(s.slug) ? (FORCE ? "REBUILD     " : "skip (exists)") : "BUILD       ";
    console.log(`  ${tag} ${s.iconEmoji} ${s.slug.padEnd(16)} — ${s.name}`);
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
    const existingId = slugToId.get(spec.slug);
    if (existingId && !FORCE) {
      console.log(`\n⏭  ${spec.slug} exists — skipping (set FORCE=1 to rebuild in place)`);
      continue;
    }
    console.log(`\n▶ ${spec.iconEmoji} ${spec.name} (${spec.slug})`);
    // 1) allocate → appId baked into the app as SUPERJAM_APP_ID (the token aud).
    // FORCE: reuse the existing appId so the baked audience stays valid (rebuild
    // in place); finalize then just re-points entryUrl at the new deploy.
    let appId: typeof existingId;
    if (existingId) {
      appId = existingId;
      console.log(`   rebuild in place — reusing appId=${appId}`);
    } else {
      const allocated = await allocateExternalApp(db, {
        manifest: manifestOf(spec),
        ownerUserId: owner.id,
      });
      appId = allocated.id;
      console.log(`   allocated appId=${appId} (status=building)`);
    }
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
