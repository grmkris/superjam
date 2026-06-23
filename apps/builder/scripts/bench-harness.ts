// Benchmark the AI-SDK harness across models × specs — timings, rounds, tokens, cost.
// One shared local builder server; runs sequentially (so timings aren't skewed by
// resource contention), each run in DRY RUN with a fresh appId/workspace. Derives
// metrics from the event stream and the "model usage —" status the harness emits.
//
//   bun run apps/builder/scripts/bench-harness.ts
//   MODELS=gemini-2.5-flash,gemini-2.5-pro bun run apps/builder/scripts/bench-harness.ts
//
// NOTE: the FIRST run pays a cold bun-install cache; later runs hit the warm cache, so
// install is ~constant overhead across models (the model rounds are the variable).
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { serve } from "@hono/node-server";
import type { AppSpec } from "@superjam/shared";
import { createBuilderApp } from "../src/app.ts";
import { makeLocalBackend } from "../src/backend/index.ts";
import { runHarnessBuild, type HarnessBuildDeps } from "../src/harness-build.ts";
import { createBuildRunner } from "../src/queue.ts";

const PORT = 47191;
const TOKEN = "bench-token";
const JWKS = "https://superjam.fun/.well-known/jwks.json";

const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!googleKey) {
  console.error("✗ GOOGLE_GENERATIVE_AI_API_KEY missing (run from repo root).");
  process.exit(1);
}

// Cheap/fast tier sweep (Pro dropped — proven wasteful). gemini-3.5-flash + the lite
// models are the candidates; gemini-flash-lite-latest is the rolling cheapest alias.
const MODELS = (
  process.env.MODELS ??
  "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-3.5-flash,gemini-flash-lite-latest"
)
  .split(",")
  .map((s) => s.trim());

// Approx Google list prices ($/1M tokens), input/output. ROUGH/ESTIMATED — relative
// comparison only (3.x prices are best-effort guesses until confirmed).
const PRICE: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gemini-3.5-flash": { in: 0.3, out: 2.5 }, // estimate (~2.5-flash tier)
  "gemini-flash-latest": { in: 0.3, out: 2.5 },
  "gemini-flash-lite-latest": { in: 0.1, out: 0.4 },
};

const clicker: AppSpec = {
  name: "Cookie Clicker",
  slug: "cookie-clicker-bench",
  description: "Tap the cookie to score; a global counter tracks everyone's all-time taps.",
  iconEmoji: "🍪",
  category: "game",
  capabilities: [],
  features: [
    "A big tappable cookie in the center with a satisfying tap animation",
    "Your personal tap count, incremented on each tap (persisted via sdk.storage)",
    "A global all-time tap counter shared across players (sdk.data.counter)",
    "Playful Toybox styling",
  ],
  data: {
    collections: [],
    counters: [{ name: "globalTaps", keyedBy: "app", meaning: "total taps by everyone" }],
    storage: [{ key: "myTaps", meaning: "this user's personal tap count" }],
  },
  ui: { layout: "single centered column", sections: ["cookie", "your taps", "global taps"] },
  acceptance: [
    "Tapping the cookie increments and displays your personal tap count",
    "The global counter increases and is visible",
    "Loads and plays with no console errors",
  ],
};

const reaction: AppSpec = {
  name: "Reaction Duel",
  slug: "reaction-duel-bench",
  description: "Tap GO the instant the screen turns green; track your best reaction time and a global best.",
  iconEmoji: "⚡",
  category: "game",
  capabilities: [],
  features: [
    "A start button; after a random 1–4s delay the screen flashes green",
    "Measure the ms between green and the player's tap; show this round's time",
    "Penalize tapping too early (false start) with a clear message",
    "Persist the player's personal best (sdk.storage) and a global best-ever (sdk.data.counter or a min via storage)",
    "Playful Toybox styling with big legible numbers",
  ],
  data: {
    collections: [],
    counters: [{ name: "globalBestMs", keyedBy: "app", meaning: "fastest reaction by anyone (lower better)" }],
    storage: [{ key: "myBestMs", meaning: "this user's fastest reaction" }],
  },
  ui: { layout: "single centered column", sections: ["arena", "your best", "global best"] },
  acceptance: [
    "Pressing start then tapping on green shows a reaction time in ms",
    "A false start (tap before green) is detected and messaged",
    "Personal best persists across reloads; no console errors",
  ],
};

const poll: AppSpec = {
  name: "Pizza Topping Showdown",
  slug: "pizza-poll-bench",
  description: "Vote for the best pizza topping and watch the live results.",
  iconEmoji: "🍕",
  category: "social",
  capabilities: [],
  features: [
    "A poll question with 4 topping options as big tappable buttons",
    "On vote, the shared tally updates and live result bars show each option's %",
    "Your pick is remembered and highlighted on return",
    "Playful Toybox styling",
  ],
  data: {
    collections: [],
    counters: [{ name: "votes", keyedBy: "option", meaning: "tally per topping" }],
    storage: [{ key: "myVote", meaning: "this user's chosen topping" }],
  },
  ui: { layout: "single centered column", sections: ["question", "options", "results"] },
  acceptance: ["Voting increments the shared tally and shows live % bars", "The user's pick is remembered", "No console errors"],
};

const quiz: AppSpec = {
  name: "World Capitals Quiz",
  slug: "capitals-quiz-bench",
  description: "A timed trivia quiz on world capitals with a global leaderboard.",
  iconEmoji: "🌍",
  category: "game",
  capabilities: [],
  features: [
    "Timed multiple-choice questions from a local question bank",
    "Lock options after the first tap, reveal correct (green) / wrong (red)",
    "Track score; show a verified-human leaderboard at the end",
    "Persist the player's best score",
  ],
  data: {
    collections: [],
    counters: [{ name: "scores", keyedBy: "username", meaning: "quiz leaderboard" }],
    storage: [{ key: "best", meaning: "this user's best score" }],
  },
  ui: { layout: "single centered column", sections: ["question", "score", "leaderboard"] },
  acceptance: ["Answering shows correct/wrong and scores it", "Leaderboard shows top scores", "No console errors"],
};

const guestbook: AppSpec = {
  name: "Birthday Wall",
  slug: "birthday-wall-bench",
  description: "A shared wall where friends leave birthday messages.",
  iconEmoji: "🎂",
  category: "social",
  capabilities: [],
  features: [
    "A text input + post button to leave a message",
    "A shared feed of everyone's messages, newest first",
    "Render all message text as plain text",
    "Playful Toybox styling",
  ],
  // Zero-backend: the shared wall uses the sdk.data.collection PRIMITIVE, not a Neon
  // relational collection — so spec.data.collections stays EMPTY (else it provisions Neon).
  data: { collections: [], counters: [], storage: [] },
  ui: { layout: "single centered column", sections: ["compose", "feed"] },
  acceptance: ["Posting adds to the shared feed", "Everyone sees all messages newest-first", "No console errors"],
};

const travel: AppSpec = {
  name: "3 Days in Lisbon",
  slug: "lisbon-trip-bench",
  description: "A curated 3-day Lisbon itinerary on an interactive map.",
  iconEmoji: "🇵🇹",
  category: "tool",
  capabilities: [],
  features: [
    "A map with the trip's stops plotted as numbered markers",
    "A day-by-day list of places (name + a one-line blurb)",
    "Mark places visited (persists per-user)",
    "Playful Toybox styling",
  ],
  data: { collections: [], counters: [], storage: [{ key: "visited", meaning: "places this user marked visited" }] },
  ui: { layout: "map on top, day list below", sections: ["map", "itinerary"] },
  skills: ["map"],
  acceptance: ["Stops plot on the map", "Day-by-day list renders", "Visited state persists; no console errors"],
};

const ALL_SPECS: { key: string; spec: AppSpec }[] = [
  { key: "clicker", spec: clicker },
  { key: "reaction", spec: reaction },
  { key: "poll", spec: poll },
  { key: "quiz", spec: quiz },
  { key: "guestbook", spec: guestbook },
  { key: "travel", spec: travel },
];
// SPECS=poll,quiz filters which specs run (default: clicker + reaction).
const wanted = (process.env.SPECS ?? "clicker,reaction").split(",").map((s) => s.trim());
const SPECS = ALL_SPECS.filter((s) => wanted.includes(s.key));

interface Ev { t: number; kind: string; label: string }
interface Row {
  model: string;
  spec: string;
  ok: boolean;
  totalS: number;
  rounds: number;
  firstBuildS: number;
  inTok: number;
  outTok: number;
  costUsd: number;
  note: string;
}

// A mutable holder so each run can swap the model the shared runner uses.
let currentModel = createGoogleGenerativeAI({ apiKey: googleKey })(MODELS[0]!);
const deps: Omit<HarnessBuildDeps, "model"> = {
  backendFactory: makeLocalBackend,
  googleKey,
  dryRun: true,
};
const runner = createBuildRunner({
  maxConcurrent: 1,
  runBuild: (a) => runHarnessBuild({ ...a, port: PORT, jwksUrl: JWKS }, { ...deps, model: currentModel }),
});
const app = createBuilderApp({ token: TOKEN, runner });
serve({ fetch: app.fetch, port: PORT });
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const runOne = async (model: string, specKey: string, spec: AppSpec, idx: number): Promise<Row> => {
  currentModel = createGoogleGenerativeAI({ apiKey: googleKey })(model);
  const appId = `app_bench${idx}`;
  const buildId = `build_bench${idx}`;
  const t0 = Date.now();
  const start = await fetch(`http://127.0.0.1:${PORT}/builds`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ spec: { ...spec, slug: `${spec.slug}-${idx}` }, buildId, appId }),
  });
  if (!start.ok) {
    return { model, spec: specKey, ok: false, totalS: 0, rounds: 0, firstBuildS: 0, inTok: 0, outTok: 0, costUsd: 0, note: `start ${start.status}` };
  }
  for (;;) {
    await sleep(1500);
    const r = await fetch(`http://127.0.0.1:${PORT}/builds/${buildId}`, { headers: auth });
    const b = (await r.json()) as { status: string; events: Ev[]; error?: string };
    if (b.status === "running") continue;

    // The poll sees `done` as soon as the harness reports it, but runHarnessBuild is
    // still in its finally{ dispose() } (stripping node_modules) so the runner is busy.
    // Await full settle before returning so the NEXT run's POST isn't 429'd.
    await runner.wait(buildId);
    const evs = b.events;
    const firstBuild = evs.find((e) => e.label.startsWith("build check"));
    const usage = [...evs].reverse().find((e) => e.label.startsWith("model usage"));
    const m = usage?.label.match(/in:(\d+) out:(\d+) tokens, (\d+) rounds/);
    const inTok = m ? Number(m[1]) : 0;
    const outTok = m ? Number(m[2]) : 0;
    const rounds = m ? Number(m[3]) : evs.filter((e) => e.label.startsWith("build check")).length;
    const price = PRICE[model] ?? { in: 0, out: 0 };
    const costUsd = (inTok * price.in + outTok * price.out) / 1_000_000;
    return {
      model,
      spec: specKey,
      ok: b.status === "done",
      totalS: Math.round((Date.now() - t0) / 1000),
      rounds,
      firstBuildS: firstBuild ? Math.round((firstBuild.t - t0) / 1000) : 0,
      inTok,
      outTok,
      costUsd,
      note: b.status === "failed" ? (b.error ?? "failed").slice(0, 60) : "",
    };
  }
};

const rows: Row[] = [];
let idx = 0;
for (const model of MODELS) {
  for (const { key, spec } of SPECS) {
    idx += 1;
    process.stdout.write(`\n▶ ${model} × ${key} … `);
    const row = await runOne(model, key, spec, idx);
    rows.push(row);
    process.stdout.write(`${row.ok ? "✓" : "✗"} ${row.totalS}s, ${row.rounds} rounds, ${(row.inTok + row.outTok).toLocaleString()} tok, $${row.costUsd.toFixed(4)}${row.note ? ` (${row.note})` : ""}`);
  }
}

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
console.log("\n\n## Harness benchmark (dry-run, bun install)\n");
console.log(`| ${pad("model", 22)} | ${pad("spec", 9)} | ok | ${padL("total", 6)} | ${padL("rnds", 4)} | ${padL("1st build", 9)} | ${padL("in tok", 8)} | ${padL("out tok", 8)} | ${padL("~$", 8)} | note |`);
console.log(`| ${"-".repeat(22)} | ${"-".repeat(9)} | -- | ${"-".repeat(6)} | ${"-".repeat(4)} | ${"-".repeat(9)} | ${"-".repeat(8)} | ${"-".repeat(8)} | ${"-".repeat(8)} | ---- |`);
for (const r of rows) {
  console.log(
    `| ${pad(r.model, 22)} | ${pad(r.spec, 9)} | ${r.ok ? "✓ " : "✗ "} | ${padL(`${r.totalS}s`, 6)} | ${padL(String(r.rounds), 4)} | ${padL(`${r.firstBuildS}s`, 9)} | ${padL(r.inTok.toLocaleString(), 8)} | ${padL(r.outTok.toLocaleString(), 8)} | ${padL(`$${r.costUsd.toFixed(4)}`, 8)} | ${r.note} |`
  );
}
console.log("\n_$ = rough est from approx Google list prices; relative comparison only._");

await Bun.write("apps/builder/scripts/bench-results.json", JSON.stringify(rows, null, 2));
console.log("→ wrote apps/builder/scripts/bench-results.json");
process.exit(0);
