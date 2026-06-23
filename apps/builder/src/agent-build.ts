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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { AppSpec } from "@superjam/shared";
import { generateImage, generateVoice } from "./assets.ts";
import {
  IMAGE_BUDGET,
  VOICE_BUDGET,
  buildSystemPrompt,
  buildTaskPrompt,
  type DriverSeams,
} from "./build-prompt.ts";
import { generateApp } from "./generate.ts";

// Where build workspaces live. PERSISTED (not tmp, not deleted) so a shipped
// jam's source survives for fixing/redeploying — losing it under tmpdir is why
// earlier demo apps became unfixable. Override with BUILD_WORKSPACE_ROOT.
const workspaceRoot = (): string =>
  process.env.BUILD_WORKSPACE_ROOT ?? join(homedir(), "superjam-builds");

// Heavy, regenerable dirs we strip from a finished workspace so the persisted
// copy stays a lightweight SOURCE archive (a build can `npm i` to restore them).
const HEAVY_DIRS = ["node_modules", ".next", ".vercel", ".git"];

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

// Agent-SDK-specific seams slotted into the shared system preamble. These name the
// REAL tools this driver hands the agent (Bash + the Vercel CLI + the Neon MCP) and
// spell out the Vercel-CLI deploy + the /report-callback reporting mechanics — none
// of which the new AI-SDK harness shares, so they live HERE, not in build-prompt.ts.
const AGENT_SEAMS: DriverSeams = {
  toolsIntro: "(Bash, the `vercel` CLI, and the Neon MCP)",
  deploy: `## Deploy (you do this yourself)
From the working directory run the Vercel CLI. Use the project name given in the task (so the platform can manage/tear it down).
- Zero-backend: \`vercel deploy --yes --prod\`
- Data app: \`vercel deploy --yes --prod --env DATABASE_URL=<pooled-dsn> --build-env DATABASE_URL=<pooled-dsn>\`
The public production URL is https://<project>.vercel.app. Verify the deploy succeeded before reporting done.`,
  reporting: `## Reporting
You MUST stream progress and exactly ONE terminal result via the callback in the task. The build is only recorded when you POST \`done\` (with the live URL + the projects you created) or \`failed\`.
Report OFTEN — the user is staring at a live status feed and silence reads as "stuck". POST a short, human, present-tense status \`label\` at EVERY meaningful step, and never go more than ~20s of work without one. Make labels specific to THIS game, not generic ("drawing the dragon sprite", "wiring the high-score board", "deploying to the web") — not "building the app" over and over. A typical build emits 6–12 status updates before the terminal report. Send one as soon as you start, before any slow tool call (asset generation, DB setup, vercel deploy), and after it finishes.
For an onchain game, include the deployed \`contractAddress\` + \`contractAbi\` in the \`done\` payload (write the JSON body to a file and \`curl … -d @done.json\` — the ABI is too big for an inline \`-d\` string) so the platform wires sdk.onchain to your contract.`,
};

/** Deterministic Vercel project name from the appId (so the platform can manage it). */
const projectName = (appId: string): string =>
  `superjam-${appId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);

// The Agent-SDK-specific tail appended to the shared task body: the /report curl
// callback instructions (progress + terminal done/failed), keyed by THIS build's
// loopback url + per-build report token. The shared body says WHAT to build; this
// says HOW this harness reports it. Leads with a blank line so it joins the body
// exactly as the original single template did.
const reportTail = (args: AgentBuildArgs, project: string): string => {
  const url = `http://127.0.0.1:${args.port}/builds/${args.buildId}/report`;
  return `

## Reporting (REQUIRED) — POST to the callback as you go, and once at the end:
Progress (call OFTEN — at every step, never >~20s of silence; use a specific, present-tense label for THIS game, e.g. "designing the screen", "drawing the sprite", "wiring the leaderboard", "deploying to the web"):
  curl -s -X POST ${url} -H "Authorization: Bearer ${args.reportToken}" -H "Content-Type: application/json" -d '{"kind":"status","label":"designing the screen"}'
On success (the production URL + the projects you created):
  curl -s -X POST ${url} -H "Authorization: Bearer ${args.reportToken}" -H "Content-Type: application/json" -d '{"kind":"done","entryUrl":"https://${project}.vercel.app","vercelProject":"${project}","neonProjectId":"<neon project id, or omit if no DB>"}'
On unrecoverable failure:
  curl -s -X POST ${url} -H "Authorization: Bearer ${args.reportToken}" -H "Content-Type: application/json" -d '{"kind":"failed","error":"<what went wrong>"}'
${
  args.spec.skills?.includes("onchain")
    ? `Onchain game — build the done body in a file (the ABI is too big to inline) and POST it:
  jq -nc --arg u "https://${project}.vercel.app" --arg p "${project}" --arg a "$CONTRACT_ADDR" --argjson abi "$CONTRACT_ABI" '{kind:"done",entryUrl:$u,vercelProject:$p,contractAddress:$a,contractAbi:$abi}' > done.json
  curl -s -X POST ${url} -H "Authorization: Bearer ${args.reportToken}" -H "Content-Type: application/json" -d @done.json
`
    : ""
}
Send the final done/failed exactly once, last.`;
};

/**
 * Run one autonomous build to completion (the agent process). Seeds the skeleton,
 * launches the agent, drains its stream, and cleans up the workspace. Resolves
 * when the agent process ends — the RESULT arrives out-of-band via /report (the
 * queue marks the build failed if no terminal report landed).
 */
export const runAgentBuild = async (args: AgentBuildArgs): Promise<void> => {
  const root = workspaceRoot();
  await mkdir(root, { recursive: true });
  // Findable by slug, collision-free (buildId is unique, but mkdtemp guarantees it).
  const ws = await mkdtemp(join(root, `${args.spec.slug}-`));
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

    // Ground the agent in the repo's source-of-truth via the shared build-prompt
    // helper (curated preamble + the real SDK reference + spec-matched recipes),
    // with THIS driver's Vercel-CLI deploy + /report mechanics slotted into the
    // seams. The shared helper is the single source of truth; only the harness-
    // specific tail differs from the AI-SDK driver.
    const project = projectName(args.appId);
    const append = await buildSystemPrompt(args.spec, AGENT_SEAMS);

    const run = query({
      prompt: buildTaskPrompt(args.spec, {
        project,
        attachmentUrls: args.attachmentUrls,
        tail: reportTail(args, project),
      }),
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
    // Keep the SOURCE (do not delete ws); just strip the heavy regenerable dirs
    // so the persisted workspace stays small. The app's source remains editable
    // + redeployable at this path.
    await Promise.all(
      HEAVY_DIRS.map((d) => rm(join(ws, d), { recursive: true, force: true }))
    );
    console.log(`[build] workspace persisted: ${ws}`);
  }
};
