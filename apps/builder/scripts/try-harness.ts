// Local trial of the AI-SDK harness build driver, on GEMINI. It wires the builder
// exactly like server.ts (queue + Hono app + LocalBackend) but with a Gemini model
// and a built-in spec, serves it on a throwaway port (so the harness's loopback
// /report works), fires ONE build, and streams the live event timeline.
//
// DEFAULT = dry run: the harness stops at a green `npx next build` and does NOT
// touch Vercel. Pass `--deploy` to actually `vercel deploy` (uses the box's logged-in
// CLI) and get a live URL.
//
//   Run from the repo root (Bun auto-loads .env → GOOGLE_GENERATIVE_AI_API_KEY):
//     bun run apps/builder/scripts/try-harness.ts            # dry run
//     bun run apps/builder/scripts/try-harness.ts --deploy   # real deploy
//     HARNESS_MODEL=gemini-2.5-flash bun run apps/builder/scripts/try-harness.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { serve } from "@hono/node-server";
import type { AppSpec } from "@superjam/shared";
import { createBuilderApp } from "../src/app.ts";
import { makeLocalBackend } from "../src/backend/index.ts";
import { runHarnessBuild } from "../src/harness-build.ts";
import { createBuildRunner } from "../src/queue.ts";

const PORT = 47190;
const TOKEN = "trial-token";
const deploy = process.argv.includes("--deploy");
const modelId = process.env.HARNESS_MODEL ?? "gemini-2.5-flash";

const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!googleKey) {
  console.error("✗ GOOGLE_GENERATIVE_AI_API_KEY missing (expected in .env). Run from the repo root.");
  process.exit(1);
}
const model = createGoogleGenerativeAI({ apiKey: googleKey })(modelId);

// A simple ZERO-BACKEND clicker: per-user count via sdk.storage + a global tally via
// sdk.data.counter. No collections ⇒ no Neon. Exercises the full loop cheaply.
const spec: AppSpec = {
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

const appId = "app_trialclicker";
const buildId = "build_trial1";

const runner = createBuildRunner({
  maxConcurrent: 1,
  runBuild: (a) =>
    runHarnessBuild(
      { ...a, port: PORT, jwksUrl: "https://superjam.fun/.well-known/jwks.json" },
      {
        backendFactory: makeLocalBackend,
        model,
        vercelToken: process.env.VERCEL_TOKEN, // omit ⇒ box's logged-in `vercel` CLI
        googleKey,
        dryRun: !deploy,
      }
    ),
});

const app = createBuilderApp({ token: TOKEN, runner });
serve({ fetch: app.fetch, port: PORT });

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const t0 = Date.now();
const secs = (t: number) => `${Math.round((t - t0) / 1000)}s`.padStart(4);

console.log(`\n🍪 harness trial — model=${modelId}  mode=${deploy ? "DEPLOY" : "dry-run"}\n`);

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
