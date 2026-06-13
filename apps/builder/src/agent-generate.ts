// Agent-fill Generator — the "agent-enhanced fill" that generate.ts's deterministic
// skeleton anticipates ("the agent path is a one-line change in server.ts"). It turns an
// AppSpec into a REAL Next.js 16 + @superjam/sdk (+ Neon) app by driving an LLM agent over
// the deterministic skeleton, guided by the recipe corpus (apps/builder/recipes/*). It
// satisfies the same `Generator` port as createTemplateGenerator, so wiring it is the
// one-line `generate:` swap in server.ts.
//
// The heavy Claude Agent SDK is injected as an `AgentRunner` port: this module is unit-
// tested with a stub, and the dependency stays isolated to the runner adapter (wired in
// server.ts on the claude-authed builder box). On ANY agent error or incomplete output it
// returns the deterministic skeleton — the agent makes apps BETTER, it never fails a build.
import type { AppSpec } from "@superjam/shared";
import type { GeneratedApp, Generator } from "@superjam/builder/deploy";
import { generateApp } from "./generate.ts";
import { loadRecipes, selectRecipes } from "./recipes.ts";

export { loadRecipes, selectRecipes };

/**
 * Run an LLM agent over a seeded workspace; return the final path→source map. The real impl
 * wraps `@anthropic-ai/claude-agent-sdk` `query()` (subscription auth on the builder box,
 * Read/Write/Edit only, a PreToolUse path-gate to the workspace); tests inject a stub.
 */
export type AgentRunner = (args: {
  system: string;
  prompt: string;
  files: Record<string, string>;
}) => Promise<Record<string, string>>;

export interface AgentGeneratorDeps {
  runAgent: AgentRunner;
  /** Concatenated recipe markdown for a spec. Defaults to reading ./recipes off disk. */
  loadRecipes?: (spec: AppSpec) => Promise<string>;
  onEvent?: (label: string) => void;
}

const renderSpec = (spec: AppSpec): string =>
  [
    `# ${spec.iconEmoji} ${spec.name} (${spec.slug})`,
    spec.description,
    `Category: ${spec.category} · Capabilities: ${spec.capabilities.join(", ") || "none"}`,
    spec.features.length ? `\n## Features\n${spec.features.map((f) => `- ${f}`).join("\n")}` : "",
    spec.data.collections.length
      ? `\n## Data collections\n${spec.data.collections.map((c) => `- ${c.name}: {${c.fields.map((f) => `${f.name}:${f.type}`).join(", ")}} — ${c.writtenWhen}`).join("\n")}`
      : "",
    spec.data.counters.length
      ? `\n## Counters\n${spec.data.counters.map((c) => `- ${c.name} (keyed by ${c.keyedBy}): ${c.meaning}`).join("\n")}`
      : "",
    `\n## Acceptance — implement until EVERY item holds\n${spec.acceptance.map((a) => `- ${a}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");

const SYSTEM_HEAD = `You are SuperJam's app builder. Generate a real, working Next.js 16 (app-router) mini-app from the spec, on top of a correct deterministic skeleton already in the workspace.

Edit ONLY: app/page.tsx, any app/api/*/route.ts the app needs, and lib/schema.ts.
NEVER edit: lib/superjam.ts, lib/db.ts, next.config.ts, the .well-known manifest route, or package.json.
Use @superjam/sdk exactly per its SDK.md (the SDK surface is unchanged). Prefer zero-backend platform primitives (sdk.data/counter/pot/ai) over an own Neon backend unless the data is relational.

The recipes below are your starting patterns — imitate the one(s) that match this spec.`;

const buildPrompt = (spec: AppSpec, recipes: string): { system: string; prompt: string } => ({
  system: `${SYSTEM_HEAD}\n\n${recipes}`,
  prompt: `Build this jam. Implement app/page.tsx (and api routes only if it brings its own data) so every acceptance item holds. Keep the fixed files unchanged.\n\n${renderSpec(spec)}`,
});

/** A real fill writes a client page that imports the SDK; a data app also fills the schema. */
const looksImplemented = (files: Record<string, string>, needsData: boolean): boolean => {
  const page = files["app/page.tsx"] ?? "";
  if (!page.includes("@superjam/sdk") || !page.includes("use client")) return false;
  if (needsData && !(files["lib/schema.ts"] ?? "").includes("pgTable")) return false;
  return true;
};

/**
 * Build the Generator. Seeds the deterministic skeleton (also the fallback), drives the
 * agent over it with the matched recipes, validates the result, and returns the richer app —
 * or the skeleton if the agent fails / under-delivers.
 */
export const createAgentGenerator = (deps: AgentGeneratorDeps): Generator =>
  async (spec, ctx): Promise<GeneratedApp> => {
    const base = generateApp(spec, ctx); // deterministic skeleton + fallback (bakes appId + JWKS)
    try {
      const recipes = await (deps.loadRecipes ?? loadRecipes)(spec);
      const { system, prompt } = buildPrompt(spec, recipes);
      deps.onEvent?.("agent: generating");
      const edited = await deps.runAgent({ system, prompt, files: base.files });
      const files = { ...base.files, ...edited };
      if (!looksImplemented(files, base.needsData)) {
        deps.onEvent?.("agent: output incomplete — shipping skeleton");
        return base;
      }
      deps.onEvent?.("agent: done");
      return { ...base, files };
    } catch (err) {
      deps.onEvent?.(`agent: failed (${err instanceof Error ? err.message : String(err)}) — shipping skeleton`);
      return base;
    }
  };
