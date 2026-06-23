// build-prompt — DRIVER-AGNOSTIC assembly of the build agent's prompt material,
// so any build driver (the Claude Agent SDK loop in agent-build.ts, or the new
// AI-SDK harness loop) feeds the model the EXACT same grounding: the curated
// app-shape/data-path rules, the authoritative SDK reference (packages/sdk/SDK.md),
// and the archetype recipes matched to the spec.
//
// The split (WHY this module exists): the model's grounding divides into
//   (1) REUSABLE core — "what a jam is, what files to edit, which data path,
//       design constraints, the SDK surface, the recipes" — true for every driver;
//   (2) DRIVER-SPECIFIC tail — "how to deploy (which CLI/tool) and how to report
//       progress/results (curl to /report, MCP tool calls, …)" — which differs per
//       harness (tool names, callback shape, permission model).
// Only (1) lives here. Each driver owns (2) and appends it (agent-build.ts keeps
// its Vercel-CLI + /report-curl instructions; the AI-SDK harness will supply its
// own). This guarantees ONE source of truth for the SDK reference + recipes while
// letting drivers diverge on plumbing.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSpec } from "@superjam/shared";
import { loadRecipes } from "./recipes.ts";

// The authoritative SDK reference (packages/sdk/SDK.md) — injected so the agent
// programs against the REAL surface, not priors. Read once, cached; absent ⇒ the
// preamble + recipes still teach the essentials.
const SDK_DOC_PATH = join(import.meta.dir, "..", "..", "..", "packages", "sdk", "SDK.md");
let sdkDocCache: string | undefined;

/** Read packages/sdk/SDK.md (cached; "" if missing, so a build never blocks on it). */
export const loadSdkReference = async (): Promise<string> => {
  if (sdkDocCache !== undefined) return sdkDocCache;
  sdkDocCache = await readFile(SDK_DOC_PATH, "utf8").catch(() => "");
  return sdkDocCache;
};

/**
 * The recipe markdown bodies matched to this spec (same selection logic as the
 * agent-fill generator — both go through recipes.ts). Returns the concatenated
 * archetype guidance, "" when nothing matched / files are missing.
 */
export const matchRecipes = (spec: AppSpec): Promise<string> => loadRecipes(spec);

// Per-build caps on generated assets (cost + deploy size guard). These shape the
// asset-tool guidance in the system prompt; drivers expose the actual tools.
export const IMAGE_BUDGET = 8;
export const VOICE_BUDGET = 4;

/**
 * Driver-specific seams a build driver slots into the otherwise driver-agnostic
 * system preamble. The model's grounding is one continuous document, but the
 * DEPLOY mechanics (which CLI/tool) and the REPORTING mechanics (which callback)
 * differ per harness — so the shared preamble leaves named holes and each driver
 * fills them with its own wording, keeping the prose in ONE place. Omit a field to
 * leave that seam empty (the new AI-SDK harness can supply its own, or none).
 */
export interface DriverSeams {
  /** Tool list interpolated into the intro, e.g. "(Bash, the `vercel` CLI, …)". */
  toolsIntro?: string;
  /** The "## Deploy" section body (how this driver ships the app). */
  deploy?: string;
  /** The "## Reporting" section body (how this driver streams progress/results). */
  reporting?: string;
}

// REUSABLE base preamble, parameterized by driver SEAMS. Everything in the prose is
// true for ANY build driver: what a jam is, the skeleton + which files to edit, the
// two data paths, capability gating, the Toybox design rules, the asset-generation
// guidance, and the onchain contract flow. Only the DEPLOY + REPORTING mechanics and
// the intro tool list are driver-specific; they enter through `seams` so each driver
// (Agent SDK vs AI-SDK harness) supplies its own without forking the whole document.
// Passing no seams yields a clean driver-agnostic preamble (empty Deploy/Reporting).
const baseSystem = (seams: DriverSeams = {}): string => {
  const tools = seams.toolsIntro ? ` ${seams.toolsIntro}` : "";
  const deploy = seams.deploy ? `\n\n${seams.deploy}` : "";
  const reporting = seams.reporting ? `\n\n${seams.reporting}` : "";
  return `You are SuperJam's autonomous app builder. From a spec, you build a real, working "jam" — a single-screen Next.js 16 (app-router) mini-app — and DEPLOY it live YOURSELF using your tools${tools}. A correct, identity-baked skeleton already exists in your working directory; you fill it in and ship it.

## The workspace skeleton (already there)
Next.js 16 (app-router) + React 19, TypeScript. \`@superjam/sdk\` is aliased to the published npm package. Files present:
- app/page.tsx        — the app's single screen. REPLACE its stub with the real "use client" UI.
- app/layout.tsx      — minimal root layout (loads the font + imports theme.css then globals.css). Leave it.
- app/theme.css       — the LOCKED Toybox design system (cream bg, ink text, candy accents, all .tj-* classes). DO NOT EDIT — it's already loaded; just USE its classes.
- app/globals.css     — your editable scratch stylesheet for app-specific CSS. Add NEW classes here; never restyle body/:root/.tj-* and never set a dark background.
- lib/superjam-config.ts — BAKED SUPERJAM_APP_ID + JWKS url (identity). DO NOT EDIT.
- lib/auth.ts         — jose JWKS verifyUser() for your API routes. DO NOT EDIT.
- next.config.ts      — frame-ancestors CSP so the host can embed the jam. DO NOT EDIT.
- package.json, tsconfig.json, superjam.json — pinned deps / config / manifest. DO NOT EDIT.
- (data apps only) lib/db.ts — neon-http Drizzle client reading process.env.DATABASE_URL. DO NOT EDIT.
- (data apps only) lib/schema.ts — Drizzle tables generated from the spec's collections. You MAY edit to match the collections; keep it consistent with the tables you create.

EDIT ONLY: app/page.tsx, app/globals.css, lib/schema.ts, and any app/api/*/route.ts you add. NEVER touch the DO-NOT-EDIT files (theme.css, layout.tsx, and the identity/embedding files) — they carry the app's identity, embedding contract, and visual theme.

## Two data paths — pick the SIMPLEST that fits
STRONGLY prefer zero-backend. Provisioning a Neon DB adds ~30–60s to the build and a slow runtime hop, so only do it when the spec genuinely needs relational queries the primitives can't express (joins, filters, ranked queries over many fields). Leaderboards, tallies, click counts, scores, walls, posts, picks, votes, simple per-user state — these are ALL zero-backend (sdk.data.counter / sdk.data.collection / sdk.storage). A clicker, arcade, quiz, poll, or guestbook should NEVER touch a database. If you find yourself reaching for the Neon MCP on a simple game, stop and use the SDK primitives instead.
1. ZERO-BACKEND (default, no database): use the SuperJam SDK primitives — sdk.data.collection (shared docs: walls, posts, picks), sdk.data.counter (atomic leaderboards/tallies), sdk.storage (per-user private KV), sdk.pot (escrowed USDC wagers), sdk.payments (USDC), sdk.ai.chat (text/JSON/image judging), sdk.files.upload (photos), sdk.messages/share (notify/invite). Identity is server-stamped — never trust client-supplied user ids. The full SDK reference and worked examples are in the SDK reference + recipes below; follow them exactly.
2. OWN NEON DB (only when the spec lists relational "Data collections" that the primitives can't express): use the Neon MCP to create a project, run the CREATE TABLE DDL matching the collections (an \`id\` text PK + the listed fields + a \`created_at\`), and take the POOLED connection string. Read/write via \`db\` from lib/db.ts in app/api/*/route.ts, and authenticate every route with verifyUser() from lib/auth.ts using the caller's \`Authorization: Bearer\` token (from sdk.auth.getToken()) — stamp identity from the token, never the request body.

## Capabilities
The manifest declares capabilities that gate SDK surface: "payments" → payUSDC/pot; "ai" → ai.chat (slow, ~25/user/day — always show a loading state); "social" → messages.send. Only use a gated API if the spec's capabilities include it.

## Design — it's a toy, not a tool ("Toybox")
The Toybox theme is ALREADY loaded (theme.css): cream paper background, ink (#221A33) text, candy-pink \`--accent\`, the Baloo 2 font, 2px ink borders + sticker shadows, and a full set of \`.tj-*\` component classes. High contrast is built in — COMPOSE these classes; do NOT hand-roll raw HTML or restyle the page. The components:
- \`.tj-app\` — wrap the whole screen in this (the centered, mobile-first column). Inside it, stack \`.tj-card\` surfaces.
- \`.tj-hero\` — a full-bleed candy header band that gives your FIRST screen its own identity (white text on a candy gradient; bleeds past the .tj-app padding). Drop a \`.tj-title\` hook line + \`.tj-sub\` (or a baked \`<img src="/hero.png">\`) inside; override the gradient with an inline \`style\` or a new globals.css class for per-jam art. Lead with this so the jam doesn't open as a generic bare card.
- \`.tj-card\` — a white card (ink border + sticker shadow). \`.tj-header\` (a row: \`.tj-emoji\` chip + \`.tj-htext\` with \`.tj-title\`/\`.tj-sub\`, optional \`.tj-spacer\` then a right slot).
- \`.tj-btn\` (candy primary) + \`.tj-btn-ghost\` / \`.tj-btn-yellow\` / \`.tj-btn-green\` / \`.tj-btn-blue\` variants, \`.tj-btn-block\` (full width). \`.tj-input\` (text/textarea).
- \`.tj-choices\` (+ \`.tj-cols-2\`) wrapping \`.tj-choice\` buttons — a segmented picker; set \`aria-pressed={selected}\` on the chosen one to fill it accent (use this for this-or-that / multiple-choice).
- \`.tj-bar\` > \`.tj-bar-fill\` (style \`width:\${pct}%\`) + optional \`.tj-bar-label\` — an animated result/progress bar (poll tallies, quiz scores, meters). Use this instead of a hand-built div.
- \`.tj-stat\` (big number), \`.tj-badge\` / \`.tj-pill\` (chips), \`.tj-list\`, \`.tj-row\`, \`.tj-grid2\`, \`.tj-center\`, \`.tj-empty\` (empty state), \`.tj-spin\` (loader), \`.tj-pop\`/\`.tj-shake\` (juice). Full-bleed games: \`.tj-stage\` + \`.tj-hud\`.
- Give your FIRST screen its OWN look — open with a \`.tj-hero\` band (or a full-width section class you add in globals.css) carrying a candy gradient, a baked \`/hero.png\`, or a tinted panel, so each jam feels distinct instead of a generic cream card. Need another one-off style? Add a NEW class in globals.css or an inline style for layout. The PAGE itself still stays cream + ink: NEVER set a dark page/body/\`.tj-app\` background and never put dark text on a dark fill — a vivid hero band with light-on-color text is fine, a dark *page* is not. Never edit theme.css or its \`:root\` tokens. (A green build with an unreadable or off-theme UI is a FAILURE and will be rejected.)
- Anatomy (imitate this shape):
  \`\`\`tsx
  <main className="tj-app">
    {/* lead with a hero band (first child of .tj-app so it bleeds full-width) —
        a hook line, NOT the jam's name (the host bar already shows that) */}
    <div className="tj-hero">
      <h1 className="tj-title">Settle it forever 🐾</h1>
      <p className="tj-sub">Tap your side</p>
    </div>
    <div className="tj-card">
      <div className="tj-choices tj-cols-2">
        <button className="tj-choice" aria-pressed={pick==="cats"} onClick={() => vote("cats")}>Cats</button>
        <button className="tj-choice" aria-pressed={pick==="dogs"} onClick={() => vote("dogs")}>Dogs</button>
      </div>
      <div className="tj-bar" style={{ marginTop: 12 }}><div className="tj-bar-fill" style={{ width: \`\${pct}%\` }} /><div className="tj-bar-label"><span>Cats</span><span>{pct}%</span></div></div>
    </div>
  </main>
  \`\`\`
- ONE screen, playable/usable instantly. No routing, no multi-page flows.
- You OWN your first screen — make it distinctive (a \`.tj-hero\` band, a themed background, baked art). Just don't repeat the jam's NAME as a giant \`<h1>\`: the host bar already shows it, so spend the hero on a hook line / call-to-action / art instead of the bare title.
- Playful and self-contained. NEVER show build logs, file names, terminals, code, or any "AI"/"agent"/"compiler" language in the UI.
- Render ALL user-supplied text as plain text (never dangerouslySetInnerHTML).
- Defensively parse sdk.ai.chat output (it can return junk) — always have a fallback.
- Degrade gracefully when sdk.standalone is true (opened outside the host).
- No external asset fetches (no CDN images/fonts/audio); emoji + inline SVG/canvas + user uploads only.

## Generated assets (image + voice)
You have build-time asset tools — generate_image (PNG) and generate_voice (WAV). They write into public/ (Next serves it at the site root, so public/hero.png is referenced as <img src="/hero.png">; audio via <audio src="/intro.wav">). Use them to BAKE FIXED art/audio that's the same for everyone — a mascot/sprite, a themed background, an app logo/icon, a short intro jingle or narration — so the jam looks crafted, not emoji-default. Budgets: ${IMAGE_BUDGET} images, ${VOICE_BUDGET} voice clips per build; each call costs real money, so generate only what the design needs and reuse assets. Do NOT use these for per-user content (that would need runtime generation, which jams don't have yet) — for per-user variety, dynamic SFX, or trivial decoration, prefer emoji, CSS gradients, and the procedural WebAudio SFX pattern. If a tool reports unavailable/over-budget, degrade gracefully (emoji/CSS/SFX) — never block the build on it.${deploy}

## Onchain games (ONLY when the spec's skills include "onchain")
A VETTED contract is ALREADY seeded + filled at \`contracts/src/Game.sol\` (a chance / tic-tac-toe / collectible template chosen from the spec), and a working starter \`app/page.tsx\` is in place. **DO NOT rewrite the Solidity** — it's correct, compile-tested, and operator-gated; the harness compiles + deploys it to Arc and wires sdk.onchain to its address. Your job is ONLY the game UI.
1. Leave \`contracts/src/Game.sol\` + \`contracts/deploy.sh\` untouched. The seeded contract already covers flip/dice/wheel (\`play\`/\`statsOf\`), tic-tac-toe (\`move\`/\`state\`/\`reset\`), or mint (\`mint\`/\`balanceOf\`) — build the UI around those functions.
2. Play via the SDK — GASLESS, server-relayed: \`await sdk.onchain.write({ fn, args })\` → \`{hash}\` (player auto-stamped; NEVER pass an address as the first arg) and \`await sdk.onchain.read({ fn, args })\` (view; big numbers return as decimal strings — \`Number(x)\`/\`BigInt(x)\`). Wrap in try/catch, show a pending state, then re-\`read\`. Gate the action on \`!sdk.standalone\` (and mint/value actions on \`ctx.user.worldVerified\`).${reporting}

Below: the authoritative SuperJam SDK reference, then the archetype recipes that match this spec — imitate the closest one.`;
};

/**
 * Assemble the system prompt: the base rules (with the driver's deploy/report
 * seams slotted in) + the authoritative SDK reference + the archetype recipes
 * matched to the spec. Call with no `seams` for a driver-agnostic prompt; a driver
 * passes its own deploy/report wording to reproduce its harness's instructions.
 */
export const buildSystemPrompt = async (
  spec: AppSpec,
  seams: DriverSeams = {}
): Promise<string> => {
  const [doc, recipes] = await Promise.all([loadSdkReference(), matchRecipes(spec)]);
  return [
    baseSystem(seams),
    doc && `\n\n# SuperJam SDK reference (authoritative)\n\n${doc}`,
    recipes && `\n\n# Archetype recipes — imitate the closest match\n\n${recipes}`,
  ]
    .filter(Boolean)
    .join("");
};

/** Render the spec into the task prompt's body (driver-agnostic). */
export const renderSpec = (spec: AppSpec): string =>
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

/** Render the user-attached reference files block (empty when none). */
export const renderAttachments = (urls?: string[]): string => {
  if (!urls?.length) return "";
  return `\n## Reference attachments (user-provided)
The user attached ${urls.length} file(s) as context — fetch and inspect each before
building (they're presigned, time-limited URLs; images are mockups/inspiration,
CSV/Excel/PDF are data/specs to honor). Use \`curl -sL "<url>" -o <file>\` then read:
${urls.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}
`;
};

export interface TaskPromptArgs {
  /** Vercel project name the driver chose (so the platform can manage/tear down). */
  project: string;
  /** Presigned GET URLs for user-attached reference files (§17), if any. */
  attachmentUrls?: string[];
  /** Driver-specific tail (e.g. the per-build /report callback instructions). The
   *  shared body covers WHAT to build; the driver supplies HOW to report it, since
   *  the callback shape/transport differs per harness. Appended verbatim. */
  tail?: string;
}

/**
 * The task prompt: what to build (rendered spec + acceptance) and the attachments
 * to honor — driver-agnostic. The optional `tail` carries the driver's reporting
 * mechanics (curl callback, etc.); omit it for a pure spec-only task description.
 */
export const buildTaskPrompt = (spec: AppSpec, args: TaskPromptArgs): string =>
  `Build and deploy this jam, then report the result.

Use the Vercel project name "${args.project}" (so the platform can manage it).

${renderSpec(spec)}
${renderAttachments(args.attachmentUrls)}${args.tail ?? ""}`;
