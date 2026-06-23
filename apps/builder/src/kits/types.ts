// Use-case kits — per-use-case scaffolding that hand-holds the build agent so a
// cheap model produces a REAL app instead of coasting on the seeded stub. A kit
// bundles: tailored clarifying questions (refine), a FILLED build plan (prompt +
// user UI), starter files the agent fills marked gaps in, and an acceptance gate
// that rejects an unfinished app. Kits are a HARNESS feature (the agent path is
// untouched) and ride on the existing recipe/skill/generate machinery.
import type { AppSpec } from "@superjam/shared";

export interface GateResult {
  ok: boolean;
  /** Human-readable, actionable gaps fed back to the model when ok=false. */
  missing: string[];
}

export interface KitContext {
  appId: string;
  buildId: string;
  jwksUrl: string;
}

export interface Kit {
  id: string;
  title: string;
  /** Does this kit apply to the spec? (keyword/skill/category match, like selectRecipes.) */
  match(spec: AppSpec): boolean;
  /** Tailored clarifying questions for refine (Phase C; unused until refine is kit-aware). */
  questions: { q: string; options: string[] }[];
  /** A FILLED, ordered build checklist — injected into the build prompt (and the user UI). */
  plan(spec: AppSpec): string;
  /** Starter files seeded into the workspace: a working app/page.tsx with `// TODO:` gaps. */
  starterFiles(spec: AppSpec, ctx: KitContext): Record<string, string>;
  /**
   * Acceptance probes over the produced files — reject the stub / an unfilled template.
   * Receives the files the harness pre-read (at least { "app/page.tsx": ... }).
   */
  gate(files: Record<string, string>): GateResult;
}
