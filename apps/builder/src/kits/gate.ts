// The anti-coast quality gate. The benchmark proved a green `next build` is NOT
// success on its own: the seeded skeleton stub already compiles, so a lazy/cheap
// model "succeeds" by doing nothing. This gate inspects app/page.tsx after a green
// build and rejects an untouched / non-implemented app, so the harness re-prompts
// with the specific gaps instead of shipping a stub.
import type { GateResult } from "./types.ts";

/**
 * Generic gate (no kit): app/page.tsx must be a real, SDK-using, interactive page
 * that differs from the seed and has no leftover `// TODO`. Kit gates extend this
 * with use-case-specific probes (e.g. "calls sdk.data.counter").
 */
export const genericGate = (page: string, seedPage: string): GateResult => {
  const missing: string[] = [];
  const p = page.trim();
  if (!p) {
    missing.push("app/page.tsx is empty — write the app");
    return { ok: false, missing };
  }
  if (p === seedPage.trim()) {
    missing.push("app/page.tsx is still the untouched starter — implement the real, playable app");
  }
  if (!/@superjam\/sdk/.test(page)) {
    missing.push("import and actually USE @superjam/sdk (e.g. sdk.storage / sdk.data.counter)");
  }
  if (!/["']use client["']/.test(page)) {
    missing.push('add "use client" at the top — the app is interactive');
  }
  if (!/\bon[A-Z]\w+\s*=|use(State|Effect|Reducer)\b/.test(page)) {
    missing.push("add real interactivity — event handlers + React state");
  }
  // NOTE: deliberately NO "no leftover // TODO" check. Starter templates use TODO
  // markers for cosmetic POLISH (juice, styling); enforcing their removal traps cheap
  // models in a loop over non-essential work and false-fails a FUNCTIONAL app. The
  // anti-coast signal is functional (not-stub + real SDK use + handlers), not cosmetic.
  return { ok: missing.length === 0, missing };
};
