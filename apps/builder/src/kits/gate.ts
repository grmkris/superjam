// The anti-coast quality gate. The benchmark proved a green `next build` is NOT
// success on its own: the seeded skeleton stub already compiles, so a lazy/cheap
// model "succeeds" by doing nothing. This gate inspects app/page.tsx (+ the theme
// files) after a green build and rejects an untouched / non-implemented / off-theme
// app, so the harness re-prompts with the specific gaps instead of shipping junk.
import type { GateResult } from "./types.ts";

/** Files the gate inspects beyond the page (the theme split + agent scratch). */
export interface GateContext {
  /** app/globals.css NOW (agent scratch) — scanned for a dark page background. */
  globals?: string;
  /** app/theme.css NOW + its seeded original — any edit to the LOCKED theme fails. */
  themeNow?: string;
  themeSeed?: string;
}

/** Relative luminance (0..255) of a CSS color, or null if we don't parse it. */
const luminance = (raw: string): number | null => {
  const c = raw.trim().toLowerCase();
  if (c === "black") return 0;
  if (c === "white") return 255;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex?.[1]) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb?.[1] && rgb[2] && rgb[3]) return 0.299 * +rgb[1] + 0.587 * +rgb[2] + 0.114 * +rgb[3];
  return null;
};
const isDark = (color: string): boolean => {
  const l = luminance(color);
  return l !== null && l < 90;
};

// A page background is "dark" only when the body/html/root — or a full-screen
// wrapper — is painted a dark color. A dark INNER element (a button, a badge) is
// fine, so we scope the check to the agent-editable surfaces that paint the page.

/** globals.css: a body/html/:root/#root/.tj-app rule with a dark background. */
const globalsDarkBg = (css?: string): boolean => {
  if (!css) return false;
  for (const block of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = block[1] ?? "";
    if (!/(?:\bbody\b|\bhtml\b|:root|#root|\.tj-app)/i.test(sel)) continue;
    const decl = (block[2] ?? "").match(/background(?:-color)?\s*:\s*([^;}]+)/i);
    if (decl?.[1] && decl[1].trim().split(/\s+/).some(isDark)) return true;
  }
  return false;
};

/** page.tsx: a dark inline background on a full-bleed element (covers the screen). */
const pageDarkFullBleed = (page: string): boolean => {
  const re = /background(?:Color)?\s*:\s*["'`]?\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)|black)/g;
  for (const m of page.matchAll(re)) {
    if (!m[1] || !isDark(m[1])) continue;
    const i = m.index ?? 0;
    const win = page.slice(Math.max(0, i - 220), i + 220);
    if (/100dvh|100vh|min-?height|position\s*:\s*["'`]?\s*fixed|inset\s*:/i.test(win)) return true;
  }
  return false;
};

/** Distinct `tj-*` class tokens used in the page (proves it composes the theme). */
const tjClassCount = (page: string): number =>
  new Set([...page.matchAll(/\btj-[a-z0-9-]+/g)].map((m) => m[0])).size;

/**
 * Generic gate (no kit): app/page.tsx must be a real, SDK-using, interactive page
 * that differs from the seed AND respects the Studio theme (composes `.tj-*`,
 * doesn't clobber the locked theme, no dark-on-dark). Kit gates extend this with
 * use-case-specific probes (e.g. "calls sdk.data.counter").
 */
export const genericGate = (
  page: string,
  seedPage: string,
  ctx: GateContext = {}
): GateResult => {
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
  // ── Look quality (the anti-"dogshit-UI" checks) ──────────────────────────
  // The locked theme (near-white bg, ink text, one vivid accent, all .tj-* classes) is
  // already loaded — the agent must USE it, not clobber it into dark-on-dark.
  if (ctx.themeSeed != null && ctx.themeNow != null && ctx.themeNow.trim() !== ctx.themeSeed.trim()) {
    missing.push("you edited app/theme.css (the LOCKED theme) — restore it unchanged and put any custom CSS in app/globals.css");
  }
  if (globalsDarkBg(ctx.globals) || pageDarkFullBleed(page)) {
    missing.push("you set a DARK page background — keep the near-white Studio theme (ink text on a near-white page); never dark-on-dark");
  }
  if (tjClassCount(page) < 2) {
    missing.push("style the UI with the Studio classes — wrap the screen in .tj-app and use .tj-card/.tj-header/.tj-btn/.tj-input/.tj-bar instead of raw/unstyled HTML");
  }
  // NOTE: deliberately NO "no leftover // TODO" check. Starter templates use TODO
  // markers for cosmetic POLISH (juice, styling); enforcing their removal traps cheap
  // models in a loop over non-essential work and false-fails a FUNCTIONAL app. The
  // anti-coast signal is functional (not-stub + real SDK use + handlers) + on-theme.
  return { ok: missing.length === 0, missing };
};
