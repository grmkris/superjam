// Local trial of the in-memory build driver, on GEMINI. It wires the builder
// exactly like server.ts (queue + Hono app + LocalBackend) but with a Gemini model
// and a built-in spec, serves it on a throwaway port (so the builder's loopback
// /report works), fires ONE build, and streams the live event timeline.
//
// DEFAULT = dry run: the builder stops at a green `npx next build` and does NOT
// touch Vercel. Pass `--deploy` to actually `vercel deploy` (uses the box's logged-in
// CLI) and get a live URL.
//
//   Run from the repo root (Bun auto-loads .env → GOOGLE_GENERATIVE_AI_API_KEY):
//     bun run apps/builder/scripts/try-build.ts            # dry run
//     bun run apps/builder/scripts/try-build.ts --deploy   # real deploy
//     BUILD_MODEL=gemini-2.5-flash bun run apps/builder/scripts/try-build.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { serve } from "@hono/node-server";
import { createNeonClient } from "@superjam/builder/deploy";
import type { AppSpec } from "@superjam/shared";
import { createBuilderApp } from "../src/app.ts";
import { makeLocalBackend } from "../src/backend/index.ts";
import { runInMemoryBuild } from "../src/in-memory-build.ts";
import { createBuildRunner } from "../src/queue.ts";

const PORT = 47190;
const TOKEN = "trial-token";
const deploy = process.argv.includes("--deploy");
// --data: build a RELATIONAL spec (data.collections → Neon) to verify the data path.
const data = process.argv.includes("--data");
const modelId = process.env.BUILD_MODEL ?? "gemini-2.5-flash";

const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!googleKey) {
  console.error("✗ GOOGLE_GENERATIVE_AI_API_KEY missing (expected in .env). Run from the repo root.");
  process.exit(1);
}
const model = createGoogleGenerativeAI({ apiKey: googleKey })(modelId);

// A simple ZERO-BACKEND clicker: per-user count via sdk.storage + a global tally via
// sdk.data.counter. No collections ⇒ no Neon. Exercises the full loop cheaply.
const clickerSpec: AppSpec = {
  name: "Cookie Clicker",
  slug: "cookie-clicker-trial",
  description: "Tap the cookie to score; a global counter tracks everyone's all-time taps.",
  iconEmoji: "🍪",
  category: "game",
  capabilities: [],
  features: [
    "A big tappable cookie in the center with a satisfying tap animation",
    "Your personal tap count, shown and incremented on each tap (persisted via sdk.storage)",
    "A global all-time tap counter shared across all players (sdk.data.counter)",
    "Playful Toybox styling — bright, rounded, chunky",
  ],
  data: {
    collections: [],
    counters: [{ name: "globalTaps", keyedBy: "app", meaning: "total taps by everyone" }],
    storage: [{ key: "myTaps", meaning: "this user's personal tap count" }],
  },
  ui: { layout: "single centered column", sections: ["cookie", "your taps", "global taps"] },
  acceptance: [
    "Tapping the cookie increments and displays your personal tap count",
    "The global counter increases and is visible to everyone",
    "Loads and plays with no console errors",
  ],
};

// A RELATIONAL spec (declared collections → Neon-backed) to verify the data path.
const dataSpec: AppSpec = {
  name: "Book Club Reviews",
  slug: "book-reviews-trial",
  description: "Members post short book reviews with a star rating; everyone sees the shared list.",
  iconEmoji: "📚",
  category: "social",
  capabilities: [],
  features: [
    "A form to submit a book title + 1-5 star rating + a short review",
    "A shared, queryable list of all reviews (newest first), backed by a real database",
    "Show the average rating per book",
  ],
  data: {
    collections: [
      {
        name: "reviews",
        fields: [
          { name: "title", type: "string" },
          { name: "rating", type: "number" },
          { name: "body", type: "string" },
        ],
        writtenWhen: "a member submits a review",
      },
    ],
    counters: [],
    storage: [],
  },
  ui: { layout: "form on top, reviews list below", sections: ["submit", "reviews"] },
  acceptance: ["Submitting a review persists it to the DB", "The shared list shows all reviews", "No console errors"],
};

// A POLL spec (matches the poll kit → .tj-choice ballot + .tj-bar results) — the
// case the Toybox-theme fix targets. `--poll`.
const poll = process.argv.includes("--poll");
const pollSpec: AppSpec = {
  name: "Cats vs Dogs Poll",
  slug: "cats-vs-dogs-trial",
  description: "Who rules the internet? Cast your vote and watch the live tally.",
  iconEmoji: "🐾",
  category: "social",
  capabilities: [],
  features: ["Cats", "Dogs"],
  data: {
    collections: [],
    counters: [{ name: "votes", keyedBy: "option", meaning: "tally per option" }],
    storage: [{ key: "myVote", meaning: "this voter's pick" }],
  },
  ui: { layout: "single card", sections: ["question", "ballot", "results"] },
  acceptance: ["Voting bumps the option's bar", "The pick survives a reload", "Bars reflect everyone's votes"],
};

// An ONCHAIN spec (skill "onchain" → the onchain kit fills a vetted contract
// template + a sdk.onchain starter; no hand-written Solidity). `--onchain`. Dry-run
// stops at the green build (skips the Arc deploy), so it verifies the page compiles
// + the kit fills the template without needing ARC keys.
const onchain = process.argv.includes("--onchain");
const onchainSpec: AppSpec = {
  name: "Coinflip Arc",
  slug: "coinflip-arc-trial",
  description: "Call heads or tails and flip an onchain coin on Arc — gasless.",
  iconEmoji: "🪙",
  category: "game",
  capabilities: ["onchain"],
  skills: ["onchain"],
  features: ["Guess heads or tails", "Track your wins onchain", "A satisfying flip animation"],
  data: { collections: [], counters: [], storage: [] },
  ui: { layout: "single card", sections: ["flip", "stats"] },
  acceptance: ["A flip calls sdk.onchain.write", "Wins persist onchain across reloads"],
};

// VIRAL kit specs (--viral=personality|roast|tier|guess) — each ends in a shareable
// result. Dry-run verifies the seeded components/result-card.tsx + page compile.
const viralArg = process.argv.find((a) => a.startsWith("--viral="))?.split("=")[1];
const VIRAL: Record<string, AppSpec> = {
  personality: { name: "Which Pizza Are You", slug: "which-pizza-trial", description: "Answer a few questions to find which pizza topping matches your personality.", iconEmoji: "🍕", category: "social", capabilities: [], features: ["fun personality questions", "a shareable result type"], data: { collections: [], counters: [], storage: [] }, ui: { layout: "card", sections: ["quiz", "result"] }, acceptance: ["shows a result type", "shareable result"] },
  roast: { name: "Roast My Startup Idea", slug: "roast-idea-trial", description: "Paste your startup idea and let the AI roast and rate it out of 10.", iconEmoji: "🔥", category: "social", capabilities: ["ai"], features: ["paste your idea", "AI roast + score", "share the burn"], data: { collections: [], counters: [], storage: [] }, ui: { layout: "card", sections: ["input", "verdict"] }, acceptance: ["AI verdict with a local fallback", "shareable"] },
  tier: { name: "Rank These Snacks", slug: "rank-snacks-trial", description: "Tap these snacks into a tier list from S to C and share your ranking.", iconEmoji: "🍿", category: "social", capabilities: [], features: ["Popcorn", "Chips", "Chocolate", "Gummies", "Pretzels"], data: { collections: [], counters: [], storage: [] }, ui: { layout: "card", sections: ["rank", "result"] }, acceptance: ["rank into tiers", "shareable ranking"] },
  guess: { name: "Daily Word Wordle", slug: "daily-word-trial", description: "Guess the daily five letter word in six tries and keep your streak.", iconEmoji: "🟩", category: "game", capabilities: [], features: ["five letter word guess", "streak", "share the emoji grid"], data: { collections: [], counters: [], storage: [] }, ui: { layout: "card", sections: ["board", "share"] }, acceptance: ["letter feedback", "shareable spoiler-free grid"] },
};
const viralSpec = viralArg ? VIRAL[viralArg] : undefined;

const spec = viralSpec ?? (data ? dataSpec : poll ? pollSpec : onchain ? onchainSpec : clickerSpec);
const appId = viralSpec ? `app_trial${viralArg}` : data ? "app_trialreviews" : poll ? "app_trialpoll" : onchain ? "app_trialonchain" : "app_trialclicker";
const buildId = viralSpec ? `build_trial${viralArg}` : data ? "build_trialdata" : poll ? "build_trialpoll" : onchain ? "build_trialonchain" : "build_trial1";
// Neon client for data apps (reads NEON_API_KEY from .env). Zero-backend builds ignore it.
const neon = process.env.NEON_API_KEY
  ? createNeonClient({ apiKey: process.env.NEON_API_KEY })
  : undefined;

const runner = createBuildRunner({
  maxConcurrent: 1,
  runBuild: (a) =>
    runInMemoryBuild(
      { ...a, port: PORT, jwksUrl: "https://superjam.fun/.well-known/jwks.json" },
      {
        backendFactory: makeLocalBackend,
        model,
        vercelToken: process.env.VERCEL_TOKEN, // omit ⇒ box's logged-in `vercel` CLI
        googleKey,
        neon,
        dryRun: !deploy,
      }
    ),
});

const app = createBuilderApp({ token: TOKEN, runner });
serve({ fetch: app.fetch, port: PORT });

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const t0 = Date.now();
const secs = (t: number) => `${Math.round((t - t0) / 1000)}s`.padStart(4);

console.log(`\n🍪 in-memory trial — model=${modelId}  mode=${deploy ? "DEPLOY" : "dry-run"}\n`);

const start = await fetch(`http://127.0.0.1:${PORT}/builds`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ spec, buildId, appId }),
});
if (!start.ok) {
  console.error(`✗ start failed (${start.status}): ${await start.text()}`);
  process.exit(1);
}

interface Status {
  status: "running" | "done" | "failed";
  events: { t: number; kind: string; label: string }[];
  result?: { entryUrl?: string };
  error?: string;
}

let seen = 0;
for (;;) {
  await new Promise((r) => setTimeout(r, 1500));
  const r = await fetch(`http://127.0.0.1:${PORT}/builds/${buildId}`, { headers: auth });
  const body = (await r.json()) as Status;
  for (; seen < body.events.length; seen += 1) {
    const e = body.events[seen]!;
    console.log(`  [${secs(e.t)}] ${e.kind === "error" ? "✗" : "•"} ${e.label}`);
  }
  if (body.status === "done") {
    console.log(`\n✅ done in ${secs(Date.now())}`);
    console.log(`   ${deploy ? "live:" : "would deploy to:"} ${body.result?.entryUrl}\n`);
    process.exit(0);
  }
  if (body.status === "failed") {
    console.log(`\n❌ failed in ${secs(Date.now())}: ${body.error}\n`);
    process.exit(1);
  }
}
