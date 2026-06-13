// agent-build — the PURE-AGENTIC build path. The platform hands us a spec; we
// seed a correct, identity-baked Next.js skeleton, then turn the subscription-
// authed Claude agent loose IN that workspace with Bash + the box's inherited
// MCPs (Neon, Vercel). The agent does the WHOLE build itself: implement the app,
// provision its own Neon DB (Neon MCP) if it needs data, and `vercel deploy` it —
// then POSTs progress + a terminal done/failed (with the resource ids it created)
// to the builder's own /builds/:id/report callback. There is NO deterministic
// fallback: if the agent doesn't report `done`, the build fails (queue.ts).
//
// Why the agent inherits the box MCPs: query() with settingSources omitted loads
// the CLI defaults (verified on this box → railway/cloudflare/vercel + Neon),
// matching the user's "launch like the CLI" intent. We unlock Bash (so it can run
// `vercel`) and keep a workspace write-gate as defense in depth.
import {
  createSdkMcpServer,
  query,
  tool,
  type HookCallback,
  type HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { AppSpec } from "@superjam/shared";
import { generateImage, generateVoice } from "./assets.ts";
import { generateApp } from "./generate.ts";
import { loadRecipes } from "./recipes.ts";

// Per-build caps on generated assets (cost + deploy size guard).
const IMAGE_BUDGET = 8;
const VOICE_BUDGET = 4;

/**
 * In-process MCP server giving the agent build-time asset generation: generate_image
 * (PNG) + generate_voice (WAV), baked into the workspace under public/ (Next serves
 * it at the root). Runs in the builder process — the Google key never enters the app
 * workspace. Writes are gated to the workspace; missing key / over-budget degrade
 * gracefully (the agent falls back to emoji / CSS / procedural SFX).
 */
const assetsMcp = (ws: string, key: string | undefined) => {
  let images = 0;
  let voices = 0;
  // Resolve an agent-supplied path under public/, gated to the workspace.
  const out = (p: string): string | null => {
    const rel = p.replace(/^\/+/, "");
    const abs = resolve(ws, rel.startsWith("public/") ? rel : join("public", rel));
    return abs.startsWith(resolve(ws)) ? abs : null;
  };
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const write = async (abs: string, bytes: Uint8Array) => {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  };
  return createSdkMcpServer({
    name: "assets",
    version: "1.0.0",
    tools: [
      tool(
        "generate_image",
        "Generate a PNG image from a prompt and write it into public/ (served at /<path>). Use for fixed art: sprites, backgrounds, a logo/icon — NOT per-user images. Reference it in the app as <img src=\"/<path>\">.",
        { prompt: z.string().min(1), path: z.string().min(1).describe("e.g. public/hero.png") },
        async ({ prompt, path }) => {
          if (!key) return ok("image generation unavailable (no key) — use an emoji or a CSS gradient instead");
          if (images >= IMAGE_BUDGET) return ok(`image budget (${IMAGE_BUDGET}) exhausted — reuse an existing asset or use emoji/CSS`);
          const abs = out(path);
          if (!abs) return ok("invalid path — must stay inside public/");
          try {
            await write(abs, await generateImage(prompt, key));
            images += 1;
            return ok(`wrote ${path} (reference it at /${path.replace(/^public\//, "").replace(/^\/+/, "")})`);
          } catch (e) {
            return ok(`image generation failed (${e instanceof Error ? e.message : String(e)}) — fall back to emoji/CSS`);
          }
        }
      ),
      tool(
        "generate_voice",
        "Synthesize speech from text to a WAV and write it into public/ (served at /<path>). Use for FIXED narration/jingles, not per-user speech. Play via an <audio> element.",
        {
          text: z.string().min(1).max(2000),
          path: z.string().min(1).describe("e.g. public/intro.wav"),
          voice: z.string().optional().describe("Gemini prebuilt voice, e.g. Kore, Puck, Charon"),
        },
        async ({ text, path, voice }) => {
          if (!key) return ok("voice generation unavailable (no key) — use procedural WebAudio SFX instead");
          if (voices >= VOICE_BUDGET) return ok(`voice budget (${VOICE_BUDGET}) exhausted`);
          const abs = out(path);
          if (!abs) return ok("invalid path — must stay inside public/");
          try {
            await write(abs, await generateVoice(text, key, voice));
            voices += 1;
            return ok(`wrote ${path} (reference it at /${path.replace(/^public\//, "").replace(/^\/+/, "")})`);
          } catch (e) {
            return ok(`voice generation failed (${e instanceof Error ? e.message : String(e)}) — fall back to SFX`);
          }
        }
      ),
    ],
  });
};

// The authoritative SDK reference (packages/sdk/SDK.md) — injected so the agent
// programs against the REAL surface, not priors. Read once, cached; absent ⇒ the
// preamble + recipes still teach the essentials.
const SDK_DOC_PATH = join(import.meta.dir, "..", "..", "..", "packages", "sdk", "SDK.md");
let sdkDocCache: string | undefined;
const sdkDoc = async (): Promise<string> => {
  if (sdkDocCache !== undefined) return sdkDocCache;
  sdkDocCache = await readFile(SDK_DOC_PATH, "utf8").catch(() => "");
  return sdkDocCache;
};

export interface AgentBuildArgs {
  spec: AppSpec;
  buildId: string;
  /** Pre-generated app id (JWT aud), baked into the skeleton + the project name. */
  appId: string;
  /** Per-build secret the agent uses to authenticate its /report calls. */
  reportToken: string;
  /** The builder's own listen port — the agent calls the loopback callback. */
  port: number;
  /** Platform JWKS baked into the app's source (identity). */
  jwksUrl: string;
  /** Coding model; defaults to a strong available one. */
  model?: string;
  maxTurns?: number;
  /** Presigned GET URLs for user-attached reference files (images/CSV/Excel/PDF, §17).
   *  Time-limited + public — the agent fetches them for context. */
  attachmentUrls?: string[];
}

/** Block any tool WRITE whose path escapes the workspace (Bash is intentionally free). */
const pathGate =
  (ws: string): HookCallback =>
  async (input): Promise<HookJSONOutput> => {
    const ti = (input as { tool_input?: Record<string, unknown> }).tool_input;
    const p = (ti?.file_path ?? ti?.path) as string | undefined;
    if (p && !resolve(ws, p).startsWith(ws)) {
      return { decision: "block", reason: "path escapes workspace" };
    }
    return {};
  };

const renderSpec = (spec: AppSpec): string =>
  [
    `# ${spec.iconEmoji} ${spec.name} (${spec.slug})`,
    spec.description,
    `Category: ${spec.category} · Capabilities: ${spec.capabilities.join(", ") || "none"}`,
    spec.features.length ? `\n## Features\n${spec.features.map((f) => `- ${f}`).join("\n")}` : "",
    spec.data.collections.length
      ? `\n## Data collections (relational → needs the Neon DB)\n${spec.data.collections
          .map((c) => `- ${c.name}: {${c.fields.map((f) => `${f.name}:${f.type}`).join(", ")}} — ${c.writtenWhen}`)
          .join("\n")}`
      : "\n(No relational data — zero-backend; do NOT provision a database.)",
    `\n## Acceptance — implement until EVERY item holds\n${spec.acceptance.map((a) => `- ${a}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");

const SYSTEM = `You are SuperJam's autonomous app builder. From a spec, you build a real, working "jam" — a single-screen Next.js 16 (app-router) mini-app — and DEPLOY it live YOURSELF using your tools (Bash, the \`vercel\` CLI, and the Neon MCP). A correct, identity-baked skeleton already exists in your working directory; you fill it in and ship it.

## The workspace skeleton (already there)
Next.js 16 (app-router) + React 19, TypeScript. \`@superjam/sdk\` is aliased to the published npm package. Files present:
- app/page.tsx        — the app's single screen. REPLACE its stub with the real "use client" UI.
- app/layout.tsx      — minimal root layout (editable, usually leave it).
- lib/superjam-config.ts — BAKED SUPERJAM_APP_ID + JWKS url (identity). DO NOT EDIT.
- lib/auth.ts         — jose JWKS verifyUser() for your API routes. DO NOT EDIT.
- next.config.ts      — frame-ancestors CSP so the host can embed the jam. DO NOT EDIT.
- package.json, tsconfig.json, superjam.json — pinned deps / config / manifest. DO NOT EDIT.
- (data apps only) lib/db.ts — neon-http Drizzle client reading process.env.DATABASE_URL. DO NOT EDIT.
- (data apps only) lib/schema.ts — Drizzle tables generated from the spec's collections. You MAY edit to match the collections; keep it consistent with the tables you create.

EDIT ONLY: app/page.tsx, app/layout.tsx, lib/schema.ts, and any app/api/*/route.ts you add. Never touch the DO-NOT-EDIT files — they carry the app's identity + embedding contract.

## Two data paths — pick the SIMPLEST that fits
1. ZERO-BACKEND (default, no database): use the SuperJam SDK primitives — sdk.data.collection (shared docs: walls, posts, picks), sdk.data.counter (atomic leaderboards/tallies), sdk.storage (per-user private KV), sdk.pot (escrowed USDC wagers), sdk.payments (USDC), sdk.ai.chat (text/JSON/image judging), sdk.files.upload (photos), sdk.messages/share (notify/invite). Identity is server-stamped — never trust client-supplied user ids. The full SDK reference and worked examples are in the SDK reference + recipes below; follow them exactly.
2. OWN NEON DB (only when the spec lists relational "Data collections" that the primitives can't express): use the Neon MCP to create a project, run the CREATE TABLE DDL matching the collections (an \`id\` text PK + the listed fields + a \`created_at\`), and take the POOLED connection string. Read/write via \`db\` from lib/db.ts in app/api/*/route.ts, and authenticate every route with verifyUser() from lib/auth.ts using the caller's \`Authorization: Bearer\` token (from sdk.auth.getToken()) — stamp identity from the token, never the request body.

## Capabilities
The manifest declares capabilities that gate SDK surface: "payments" → payUSDC/pot; "ai" → ai.chat (slow, ~25/user/day — always show a loading state); "social" → messages.send. Only use a gated API if the spec's capabilities include it.

## Design — it's a toy, not a tool ("Toybox")
- ONE screen, playable/usable instantly. No routing, no multi-page flows.
- Playful and self-contained. NEVER show build logs, file names, terminals, code, or any "AI"/"agent"/"compiler" language in the UI.
- Render ALL user-supplied text as plain text (never dangerouslySetInnerHTML).
- Defensively parse sdk.ai.chat output (it can return junk) — always have a fallback.
- Degrade gracefully when sdk.standalone is true (opened outside the host).
- No external asset fetches (no CDN images/fonts/audio); emoji + inline SVG/canvas + user uploads only.

## Generated assets (image + voice)
You have build-time asset tools — generate_image (PNG) and generate_voice (WAV). They write into public/ (Next serves it at the site root, so public/hero.png is referenced as <img src="/hero.png">; audio via <audio src="/intro.wav">). Use them to BAKE FIXED art/audio that's the same for everyone — a mascot/sprite, a themed background, an app logo/icon, a short intro jingle or narration — so the jam looks crafted, not emoji-default. Budgets: ${IMAGE_BUDGET} images, ${VOICE_BUDGET} voice clips per build; each call costs real money, so generate only what the design needs and reuse assets. Do NOT use these for per-user content (that would need runtime generation, which jams don't have yet) — for per-user variety, dynamic SFX, or trivial decoration, prefer emoji, CSS gradients, and the procedural WebAudio SFX pattern. If a tool reports unavailable/over-budget, degrade gracefully (emoji/CSS/SFX) — never block the build on it.

## Deploy (you do this yourself)
From the working directory run the Vercel CLI. Use the project name given in the task (so the platform can manage/tear it down).
- Zero-backend: \`vercel deploy --yes --prod\`
- Data app: \`vercel deploy --yes --prod --env DATABASE_URL=<pooled-dsn> --build-env DATABASE_URL=<pooled-dsn>\`
The public production URL is https://<project>.vercel.app. Verify the deploy succeeded before reporting done.

## Reporting
You MUST stream progress and exactly ONE terminal result via the callback in the task. The build is only recorded when you POST \`done\` (with the live URL + the projects you created) or \`failed\`.

Below: the authoritative SuperJam SDK reference, then the archetype recipes that match this spec — imitate the closest one.`;

const renderAttachments = (urls?: string[]): string => {
  if (!urls?.length) return "";
  return `\n## Reference attachments (user-provided)
The user attached ${urls.length} file(s) as context — fetch and inspect each before
building (they're presigned, time-limited URLs; images are mockups/inspiration,
CSV/Excel/PDF are data/specs to honor). Use \`curl -sL "<url>" -o <file>\` then read:
${urls.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}
`;
};

const buildPrompt = (args: AgentBuildArgs): string => {
  const project = `superjam-${args.appId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);
  const url = `http://127.0.0.1:${args.port}/builds/${args.buildId}/report`;
  return `Build and deploy this jam, then report the result.

Use the Vercel project name "${project}" (so the platform can manage it).

${renderSpec(args.spec)}
${renderAttachments(args.attachmentUrls)}

## Reporting (REQUIRED) — POST to the callback as you go, and once at the end:
Progress (call a few times so the user sees movement):
  curl -s -X POST ${url} -H "Authorization: Bearer ${args.reportToken}" -H "Content-Type: application/json" -d '{"kind":"status","label":"building the app"}'
On success (the production URL + the projects you created):
  curl -s -X POST ${url} -H "Authorization: Bearer ${args.reportToken}" -H "Content-Type: application/json" -d '{"kind":"done","entryUrl":"https://${project}.vercel.app","vercelProject":"${project}","neonProjectId":"<neon project id, or omit if no DB>"}'
On unrecoverable failure:
  curl -s -X POST ${url} -H "Authorization: Bearer ${args.reportToken}" -H "Content-Type: application/json" -d '{"kind":"failed","error":"<what went wrong>"}'

Send the final done/failed exactly once, last.`;
};

/**
 * Run one autonomous build to completion (the agent process). Seeds the skeleton,
 * launches the agent, drains its stream, and cleans up the workspace. Resolves
 * when the agent process ends — the RESULT arrives out-of-band via /report (the
 * queue marks the build failed if no terminal report landed).
 */
export const runAgentBuild = async (args: AgentBuildArgs): Promise<void> => {
  const ws = await mkdtemp(join(tmpdir(), "sj-build-"));
  try {
    const base = generateApp(args.spec, {
      buildId: args.buildId,
      appId: args.appId,
      jwksUrl: args.jwksUrl,
    });
    await Promise.all(
      Object.entries(base.files).map(async ([p, src]) => {
        const abs = join(ws, p);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, src);
      })
    );

    // Ground the agent in the repo's source-of-truth: the curated preamble, the
    // real SDK reference, and the archetype recipes matched to this spec.
    const [doc, recipes] = await Promise.all([sdkDoc(), loadRecipes(args.spec)]);
    const append = [
      SYSTEM,
      doc && `\n\n# SuperJam SDK reference (authoritative)\n\n${doc}`,
      recipes && `\n\n# Archetype recipes — imitate the closest match\n\n${recipes}`,
    ]
      .filter(Boolean)
      .join("");

    const run = query({
      prompt: buildPrompt(args),
      options: {
        cwd: ws,
        systemPrompt: { type: "preset", preset: "claude_code", append },
        model: args.model ?? "claude-sonnet-4-6",
        maxTurns: args.maxTurns ?? 48,
        // Headless: auto-accept. Bash is ALLOWED (the agent runs `vercel`); the
        // write-gate keeps Edit/Write inside the workspace. MCPs inherited from
        // the box CLI config (settingSources omitted = CLI defaults) MERGE with
        // our in-process `assets` server (build-time image/voice generation).
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        mcpServers: { assets: assetsMcp(ws, process.env.GOOGLE_GENERATIVE_AI_API_KEY) },
        hooks: { PreToolUse: [{ hooks: [pathGate(ws)] }] },
      },
    });
    for await (const _msg of run) {
      // drain — the result is delivered by the agent's /report callbacks.
    }
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
};
