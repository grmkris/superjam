// tap-arcade — the first use-case kit: tap/clicker/arcade games with a personal
// score (sdk.storage) + a shared cross-user leaderboard (sdk.data.counter). The
// kit hand-holds the cheap build model: a tailored match, clarifying questions, a
// FILLED plan, a near-complete starter app/page.tsx with a few marked gaps, and a
// gate that rejects an unfilled stub.
//
// SDK CONTRACT — RECONCILED against what actually compiles+runs (NOT SDK.md's
// prop signature): SDK.md shows `export default function App({ sdk, ctx })` with
// props injected by the host. But the generated skeleton (generate.ts `page()`)
// and EVERY known-good build (superjam-builds/*bench5,bench7) instead use a
// "use client" default-export page that obtains the sdk itself:
//   import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
//   const sdk = await SuperJam.connect();   // inside a useEffect
//   const ctx = sdk.app.context();          // synchronous, after connect
// That self-connect pattern is what the Next skeleton mounts + what builds green,
// so the starter below follows it. `counter.increment(key, n) → number`,
// `counter.top(n) → {key,value}[]`, `storage.get<T>(key) → T|null`,
// `storage.set(key, val)`.
import type { AppSpec } from "@superjam/shared";
import type { GateResult, Kit, KitContext } from "./types.ts";

// Mirrors selectRecipes' keyword heuristic: category=game OR a game skill OR the
// name/description/features read like a tapper/clicker/arcade/idle score game.
const TAP_RE = /tap|click|tapper|clicker|arcade|score|cookie|idle|incremental/i;

const match = (spec: AppSpec): boolean => {
  if (spec.category === "game") return true;
  if (spec.skills?.some((s) => s === "game-2d" || s === "game-3d")) return true;
  const hay = `${spec.name} ${spec.description} ${spec.features.join(" ")}`;
  return TAP_RE.test(hay);
};

const questions: Kit["questions"] = [
  {
    q: "What does the player tap?",
    options: ["A big emoji/object", "A character", "A button/target", "The whole screen"],
  },
  {
    q: "What's the reward for tapping?",
    options: ["A rising score", "Coins/currency to spend", "Unlocking achievements", "Filling a progress goal"],
  },
  {
    q: "How competitive is it?",
    options: ["Solo high-score chase", "Global leaderboard", "Both — personal best + global board"],
  },
];

// Pick the spec's first declared counter/storage names so the plan + starter wire
// the EXACT keys the spec promised; fall back to sensible tap-game defaults.
const counterName = (spec: AppSpec): string => spec.data.counters[0]?.name ?? "scores";
const storageKey = (spec: AppSpec): string => spec.data.storage[0]?.key ?? "best";

const plan = (spec: AppSpec): string => {
  const emoji = spec.iconEmoji;
  const counter = counterName(spec);
  const store = storageKey(spec);
  const feats = spec.features.length
    ? spec.features.map((f) => `   - ${f}`).join("\n")
    : "   - (no extra features declared — keep it a tight tap loop)";
  return `# Build plan — ${emoji} ${spec.name} (tap / arcade game)

1. Connect on mount: \`const sdk = await SuperJam.connect()\` inside a useEffect,
   then \`sdk.app.context()\` for the player. Show a loading state until ready.
2. Load saved state: read the personal best/score from
   \`sdk.storage.get<number>("${store}")\` (null ⇒ 0) and the leaderboard from
   \`sdk.data.counter("${counter}").top(10)\`.
3. Render the big tappable ${emoji} target front-and-center, plus the player's
   current score and the global leaderboard.
4. On tap: optimistic +1 to React state (instant feedback), persist the personal
   score via \`sdk.storage.set("${store}", next)\`, and credit the shared board
   with \`sdk.data.counter("${counter}").increment(ctx.user.username, 1)\`.
5. Juice: a tap animation (scale/pop), a sound or "+1" floater — make the tap
   feel good. Debounce the network writes if taps come fast.
6. Show the leaderboard from \`top(10)\`, highlighting the row where
   \`key === ctx.user.username\`. Refresh it after the player's own writes.
7. Wire the spec's specifics:
${feats}
8. Acceptance: tapping increments the visible score, the score survives a reload
   (storage), and the player appears on the global leaderboard (counter).`;
};

// A near-complete, TYPE-CORRECT starter. It compiles as-is (the gaps are visual /
// styling / exact-key wiring, not type holes) and follows the self-connect pattern
// proven by the known-good builds. The model fills the `// TODO:` gaps.
const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const counter = counterName(spec);
  const store = storageKey(spec);
  const page = `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

// ${title} — a tap game. Personal score persists in sdk.storage("${store}");
// the shared leaderboard is sdk.data.counter("${counter}").
export default function Page() {
  const [sdk, setSdk] = useState<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [score, setScore] = useState(0);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [popped, setPopped] = useState(false);
  const scoreRef = useRef(0);

  // Connect once, then load saved score + leaderboard (self-connect pattern).
  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect();
      setSdk(s);
      setCtx(s.app.context());
      const saved = (await s.storage.get<number>("${store}")) ?? 0;
      scoreRef.current = saved;
      setScore(saved);
      setBoard(await s.data.counter("${counter}").top(10));
      setLoading(false);
    })();
  }, []);

  async function tap() {
    if (!sdk || !ctx) return;
    // Optimistic +1 for instant feedback.
    const next = scoreRef.current + 1;
    scoreRef.current = next;
    setScore(next);
    setPopped(true);
    setTimeout(() => setPopped(false), 90);
    // Persist personal score + credit the shared leaderboard.
    await sdk.storage.set("${store}", next);
    await sdk.data.counter("${counter}").increment(ctx.user.username, 1);
    setBoard(await sdk.data.counter("${counter}").top(10));
    // TODO: add the "juice" — a "+1" floater, a sound (see bench builds), or a
    // shake. Make the tap feel satisfying.
  }

  const me = ctx?.user.username ?? "you";

  if (loading) {
    return (
      <main className="tj-app tj-center">
        <div className="tj-card">
          <div className="tj-spin" />
          <p className="tj-sub">Loading ${title}…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="tj-app">
      <div className="tj-card tj-center">
        <h1 className="tj-title">${emoji} ${title}</h1>
        <p className="tj-sub">Tap to score. Climb the board.</p>

        {/* TODO: make this the BIG, juicy tap target — style the ${emoji}, size it
            up, and animate it on \`popped\` (scale/pop). This is the heart of the
            game; don't leave it a plain button. */}
        <button
          className="tj-btn"
          onClick={tap}
          style={{ fontSize: 72, padding: 24, transform: popped ? "scale(0.92)" : "scale(1)", transition: "transform .09s" }}
          aria-label="Tap to score"
        >
          ${emoji}
        </button>

        <div className="tj-stat">{score}</div>
        <p className="tj-muted">your score</p>
      </div>

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>Leaderboard 👑</h2>
        <ul className="tj-list">
          {board.map((row) => (
            <li key={row.key} style={row.key === me ? { color: "var(--accent)", fontWeight: 800 } : undefined}>
              <b>@{row.key}</b> <span className="tj-muted">{row.value}</span>
            </li>
          ))}
          {board.length === 0 && <div className="tj-empty">No scores yet — tap to be first!</div>}
        </ul>
        {/* TODO: highlight the player's own rank (medal for top 3) and, if the spec
            wants it, show a global/combined total above the board. */}
      </div>
    </main>
  );
}
`;
  return { "app/page.tsx": page };
};

// Kit gate — runs ALONGSIDE the generic gate (which already checks @superjam/sdk
// usage, "use client", interactivity, and no leftover TODO). Here we add the
// tap-game-specific probes so a model can't pass by writing a non-game.
const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  // Use-case core only (the generic gate already enforces not-stub + sdk import +
  // "use client" + interactivity). Match the METHOD CHAIN, not an `sdk.` prefix —
  // the connected sdk variable can be named anything (`sdk`, `s`, `sj`).
  if (!/\.data\.counter\(/.test(page)) {
    missing.push("use data.counter(...).increment/top for the SHARED score leaderboard");
  }
  if (!/shareResult\(|\.share\.link\(/.test(page)) {
    missing.push('end on a Share button — import { shareResult } from "@/components/result-card" and call shareResult(sdk, { text, data }) so players share "I scored X — beat me"');
  }
  return { ok: missing.length === 0, missing };
};

export const tapArcadeKit: Kit = {
  id: "tap-arcade",
  title: "Tap / arcade game",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
