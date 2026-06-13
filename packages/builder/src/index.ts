// @superjam/builder — the platform's app-build machinery (§11, pivot §6):
// refine (idea → AppSpec, platform-side Gemini) and the deploy orchestration
// (generate → Neon → Vercel → entryUrl). The token-gated executor service is
// apps/builder; this package holds the reusable, side-effect-free cores.
export * from "./refine.ts";
export * from "./deploy/index.ts";
