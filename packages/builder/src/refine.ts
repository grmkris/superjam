// Refine stage (§11) — idea → AppSpec, interactive + cheap. PRIMARY path is
// Gemini via the AI SDK `generateObject`, running PLATFORM-side: no builder
// round-trip, so the wizard stays alive when the builder is busy/down. The
// keyless fallback (Agent SDK answer-tool session on the builder box) lives in
// apps/builder; both speak the one shared `RefineResult` union.
//
// The model only ever returns the zod-validated union — never parsed prose.
// `skills` is a closed enum (§10), so a hallucinated skill is impossible. The
// SIMILAR-check is the platform's job: we inject the listed-apps catalog into
// the prompt, then server-side DROP any returned slug that isn't a real listed
// app (the model can name-drop; we trust only the catalog).
import {
  type AppSpec,
  type RefineResult,
  RefineResultSchema,
  SIMILAR_MAX,
} from "@superjam/shared";
import { google } from "@ai-sdk/google";
import { generateObject, type LanguageModel } from "ai";

// Gemini, fast. Overridable for tests / model bumps. 2.0-flash was retired by Google
// (generateContent → 404); flash-lite is the fastest GA 2.5 model — the wizard's
// idle "thinking…" is latency-visible, so we trade a little reasoning for speed.
export const DEFAULT_REFINE_MODEL = "gemini-2.5-flash-lite";

/** A listed app, rendered into the prompt for the similar-check. */
export interface RefineCatalogApp {
  slug: string;
  name: string;
  description: string;
  category: string;
}

export interface RefineInput {
  /** The user's raw idea (or change request, when remixing). */
  prompt: string;
  /** Prior clarifying Q/A — passed back each round (refine is stateless). */
  answers?: { q: string; a: string }[];
  /**
   * The base app's spec when remixing — the refiner extends/modifies it and
   * MUST pick a new name + slug. Adjust/remix rounds skip the similar-check.
   */
  baseSpec?: AppSpec;
  /**
   * Listed-apps catalog for the similar-check. Omit/empty to skip it (the
   * platform skips it on adjust re-refines and remixes for wizard latency).
   */
  catalog?: RefineCatalogApp[];
  /**
   * Reference images the user attached to the build prompt (data URLs or http
   * URLs). Fed to Gemini as vision so the spec reflects a sketch/mockup. Non-image
   * attachments (CSV/PDF) are NOT sent here — they go to the builder agent.
   */
  images?: string[];
}

/**
 * The generate port. The default wraps Gemini `generateObject`; tests inject a
 * deterministic fake so the prompt-assembly + similar-filter logic is unit
 * testable without a live key.
 */
export type RefineGenerator = (args: {
  system: string;
  prompt: string;
  images?: string[];
}) => Promise<RefineResult>;

const SYSTEM = `You are SuperJam's app-idea refiner. The user wants a small,
single-screen web mini app (often a game) that an agent will build from your
spec and deploy live. Your job: decide whether the idea is precise enough to
build, and if so produce a complete, concrete AppSpec.

Return EXACTLY ONE of two shapes:

1. type "questions" — when the idea is too vague to build well. Ask 2-4 sharp
   multiple-choice questions (2-4 short options each) that pin down the core
   mechanic, content, or tone. NEVER ask about tech, frameworks, or styling.

2. type "spec" — when the idea (plus any clarifications) is precise enough.
   Fill every field concretely:
   - name: short human title. slug: kebab-case, 3-32 chars, NEW + unique.
   - description: one sentence. iconEmoji: a single emoji.
   - category: one of game | social | tool | creative | other.
   - capabilities: which of payments | ai | social this app actually uses.
   - features: 3-6 concrete bullets the build agent must implement.
   - data: the app's persistence, expressed against the SuperJam SDK —
       collections (shared docs everyone sees: walls, posts, leaderboards) —
       each with a "fields" list of { name, type } where type is
       string | number | boolean; counters (atomic tallies keyed by something);
       storage (per-user keys). Only include what the features need; empty arrays
       are fine.
   - payments (only if capability "payments"): actions { label, amountUsdc, to:"appTreasury" }.
   - ai (only if capability "ai"): uses — what the in-app AI is asked to do.
   - social (only if capability "social"): messagesSentWhen — when one-way
       messages go out.
   - ui: layout (one phrase) + sections (the on-screen blocks).
   - skills: 0-3 build skills, ONLY when clearly needed — game-3d (3D scene),
       game-2d (canvas arcade), charts (visualize shared data), motion
       (animated polished UI), art (AI-generated image assets), judge (AI
       scoring/resolution), market (on-chain/marketplace). Omit when none fit.
   - acceptance: a self-check list the build agent verifies before shipping.

Mini apps get a SuperJam SDK: per-user storage, shared collections + a shared
leaderboard, the user's identity (username/wallet) + friends, one-way messages,
mock USDC payments, AI calls (text/JSON/tool decisions) + image generation, and
photo uploads. PREFER features that use these (global leaderboard, AI-generated
levels, photo walls, tip jars).

Return spec directly when the prompt is already precise — do not invent friction.`;

const SIMILAR_INSTRUCTION = `\n\nThese apps are already listed on SuperJam. If
the user's idea SUBSTANTIALLY duplicates one, also set "similar" (up to 3) with
each app's slug and a one-line reason. Only reference apps from this list:`;

/** Assemble the (system, prompt) pair. Exported for unit testing. */
export const buildPrompt = (input: RefineInput): { system: string; prompt: string } => {
  const parts: string[] = [`User idea: "${input.prompt}"`];

  if (input.baseSpec) {
    parts.push(
      `\nBASE SPEC — the user is REMIXING this app. Extend/modify it per their` +
        ` idea and pick a NEW name + slug:\n${JSON.stringify(input.baseSpec)}`
    );
  }

  if (input.answers?.length) {
    parts.push(
      `\nClarifications so far:\n${input.answers
        .map((x) => `Q: ${x.q}\nA: ${x.a}`)
        .join("\n")}`
    );
  }

  let system = SYSTEM;
  if (input.catalog?.length) {
    system +=
      SIMILAR_INSTRUCTION +
      "\n" +
      input.catalog
        .map(
          (a) =>
            `${a.slug} | ${a.name} | ${a.description.slice(0, 140)} | ${a.category}`
        )
        .join("\n");
  }

  return { system, prompt: parts.join("\n") };
};

/**
 * Trust only the catalog: drop any `similar` slug the model returned that isn't
 * a real listed app, and cap to SIMILAR_MAX. Empty result ⇒ drop the field.
 * Exported for unit testing.
 */
export const filterSimilar = (
  result: RefineResult,
  catalog?: RefineCatalogApp[]
): RefineResult => {
  if (!result.similar?.length) {
    return result.similar === undefined ? result : { ...result, similar: undefined };
  }
  const known = new Set((catalog ?? []).map((a) => a.slug));
  const kept = result.similar.filter((s) => known.has(s.slug)).slice(0, SIMILAR_MAX);
  return { ...result, similar: kept.length ? kept : undefined };
};

// data URL passes through; an http(s) URL becomes a URL the AI SDK fetches.
const toImageData = (s: string): string | URL =>
  s.startsWith("data:") ? s : new URL(s);

const geminiGenerator =
  (model: LanguageModel): RefineGenerator =>
  async ({ system, prompt, images }) => {
    // With reference images, send a multimodal user message; otherwise the plain
    // prompt string (cheaper, unchanged behaviour).
    const common = { model, schema: RefineResultSchema, system } as const;
    if (images?.length) {
      const { object } = await generateObject({
        ...common,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...images.map((img) => ({ type: "image" as const, image: toImageData(img) })),
            ],
          },
        ],
      });
      return object;
    }
    const { object } = await generateObject({ ...common, prompt });
    return object;
  };

/**
 * Refine an idea into a `RefineResult` (questions OR a finished spec). Inject a
 * `generate` fake or a `model` override in tests; production uses Gemini.
 */
export const refine = async (
  input: RefineInput,
  deps: { generate?: RefineGenerator; model?: LanguageModel } = {}
): Promise<RefineResult> => {
  const generate =
    deps.generate ?? geminiGenerator(deps.model ?? google(DEFAULT_REFINE_MODEL));
  const { system, prompt } = buildPrompt(input);
  const result = await generate({ system, prompt, images: input.images });
  return filterSimilar(result, input.catalog);
};
