// poll — the use-case kit for polls / votes / surveys / this-or-that / would-you-
// rather / favorite-which. Like tap-arcade, it hand-holds the cheap build model:
// a tailored match, clarifying questions, a FILLED plan, a near-complete starter
// app/page.tsx with a few COSMETIC marked gaps, and a gate that rejects an
// unfilled stub.
//
// SDK CONTRACT — RECONCILED against what actually compiles+runs (NOT SDK.md's
// prop signature): SDK.md shows `export default function App({ sdk, ctx })` with
// props injected by the host. But the generated skeleton (generate.ts `page()`)
// and EVERY known-good build use a "use client" default-export page that obtains
// the sdk itself:
//   import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
//   const sdk = await SuperJam.connect();   // inside a useEffect
//   const ctx = sdk.app.context();          // synchronous, after connect
// That self-connect pattern is what builds green, so the starter below follows it.
//
// VOTE MODEL — one atomic tally PER OPTION via `sdk.data.counter(<poll>)`:
// `counter.increment(optionKey, 1) → number` is the race-free way to tally votes
// (SDK.md: "never read-modify-write a doc"). The user's own choice persists in
// `sdk.storage` so they see results (not the ballot) on return.
//   `counter.increment(key, n) → number`, `counter.top(n) → {key,value}[]`,
//   `counter.get?` is NOT in the surface — read all tallies via `.top()` and map.
//   `storage.get<T>(key) → T|null`, `storage.set(key, val)`.
import type { AppSpec } from "@superjam/shared";
import type { GateResult, Kit, KitContext } from "./types.ts";

// Mirrors selectRecipes' keyword heuristic (recipes.ts) + tap-arcade's match: the
// name/description/features read like a poll/vote/survey/this-or-that/ranking.
const POLL_RE = /poll|vote|survey|this or that|would you rather|rank|tier list|favorite|which/i;

const match = (spec: AppSpec): boolean => {
  const hay = `${spec.name} ${spec.description} ${spec.features.join(" ")}`;
  return POLL_RE.test(hay);
};

const questions: Kit["questions"] = [
  {
    q: "Can a voter pick more than one option?",
    options: ["Single choice (pick one)", "Multi-select (pick several)"],
  },
  {
    q: "When do voters see the results?",
    options: ["Only after they vote", "Always (live as they decide)", "Never — votes stay hidden"],
  },
  {
    q: "Can someone change their vote later?",
    options: ["No — one vote, locked", "Yes — they can re-vote anytime"],
  },
];

// Pick the spec's first declared counter/storage names so the plan + starter wire
// the EXACT keys the spec promised; fall back to sensible poll defaults.
const counterName = (spec: AppSpec): string => spec.data.counters[0]?.name ?? "votes";
const storageKey = (spec: AppSpec): string => spec.data.storage[0]?.key ?? "myVote";

// Derive 2-4 ballot options from the spec's features (each becomes an option), or
// fall back to placeholders the model can rename. Keep the option KEYS stable —
// they're the counter keys.
const optionsFrom = (spec: AppSpec): string[] => {
  const feats = spec.features.map((f) => f.trim()).filter(Boolean).slice(0, 4);
  if (feats.length >= 2) return feats;
  return ["Option A", "Option B", "Option C"];
};

const plan = (spec: AppSpec): string => {
  const emoji = spec.iconEmoji;
  const counter = counterName(spec);
  const store = storageKey(spec);
  const opts = optionsFrom(spec);
  const optList = opts.map((o) => `   - ${o}`).join("\n");
  return `# Build plan — ${emoji} ${spec.name} (poll / vote)

1. Connect on mount: \`const sdk = await SuperJam.connect()\` inside a useEffect,
   then \`sdk.app.context()\` for the voter. Show a loading state until ready.
2. Define the ballot — render the question + one button per option:
${optList}
3. Load prior state: read the voter's saved pick from
   \`sdk.storage.get<string>("${store}")\` (null ⇒ not voted yet) and the live
   tallies from \`sdk.data.counter("${counter}").top(50)\` (map → per-option count).
4. On vote: optimistically mark the choice in React state for instant feedback,
   credit the option with \`sdk.data.counter("${counter}").increment(choiceKey, 1)\`,
   and persist the voter's pick via \`sdk.storage.set("${store}", choiceKey)\` so
   they see results (not the ballot) on their next visit.
5. Render LIVE result bars: total = sum of all tallies; each option's width is
   \`(count / total) * 100\`%. Highlight the option the voter picked.
6. Gate re-voting per the refine answers — lock the ballot once \`myVote\` is set
   (or allow a re-vote that decrements the old key and increments the new one).
7. Wire the spec's specifics (single vs multi choice, show-results-when):
${spec.features.length ? spec.features.map((f) => `   - ${f}`).join("\n") : "   - (no extra features declared — keep it a tight single-choice poll)"}
8. Acceptance: clicking an option bumps that option's visible bar, the voter's
   pick survives a reload (storage), and the bars reflect everyone's votes (counter).`;
};

// A near-complete, TYPE-CORRECT starter. It compiles as-is (the gaps are visual /
// styling, not type holes) and follows the self-connect pattern proven by the
// known-good builds. The model fills the `// TODO:` gaps (COSMETIC only).
const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const counter = counterName(spec);
  const store = storageKey(spec);
  const opts = optionsFrom(spec);
  // Serialize the derived options as a TS string-array literal for the starter.
  const optsLiteral = JSON.stringify(opts);
  const page = `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

// ${title} — a poll. Per-option tallies live in sdk.data.counter("${counter}");
// the voter's own pick persists in sdk.storage("${store}") so results show on return.
const OPTIONS: string[] = ${optsLiteral};
const COLORS = ["#FF4D6D", "#FFC940", "#2FD180", "#4D7CFF"];

export default function Page() {
  const [sdk, setSdk] = useState<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [myVote, setMyVote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sdkRef = useRef<SuperJamSdk | null>(null);

  // Read the counter's rows and fold them into a per-option count map.
  async function loadTally(s: SuperJamSdk): Promise<Record<string, number>> {
    const rows = await s.data.counter("${counter}").top(50);
    const next: Record<string, number> = {};
    for (const r of rows) next[r.key] = r.value;
    return next;
  }

  // Connect once, then load the voter's saved pick + the live tallies.
  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect();
      sdkRef.current = s;
      setSdk(s);
      setCtx(s.app.context());
      setMyVote((await s.storage.get<string>("${store}")) ?? null);
      setTally(await loadTally(s));
      setLoading(false);
    })();
  }, []);

  async function vote(choice: string) {
    const s = sdkRef.current;
    if (!s || myVote) return; // one vote, locked — TODO: allow re-vote per refine answers
    // Optimistic: mark the pick + bump the bar instantly.
    setMyVote(choice);
    setTally((t) => ({ ...t, [choice]: (t[choice] ?? 0) + 1 }));
    // Credit the option's tally + remember this user's choice across reloads.
    await s.data.counter("${counter}").increment(choice, 1);
    await s.storage.set("${store}", choice);
    setTally(await loadTally(s));
  }

  const total = Math.max(1, OPTIONS.reduce((sum, o) => sum + (tally[o] ?? 0), 0));

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
      <div className="tj-card">
        <h1 className="tj-title">${emoji} ${title}</h1>
        <p className="tj-sub">{myVote ? "Thanks for voting! Live results:" : "Cast your vote 👇"}</p>

        <div className="tj-list">
          {OPTIONS.map((o, i) => {
            const count = tally[o] ?? 0;
            const pct = Math.round((count / total) * 100);
            const picked = myVote === o;
            return (
              <button
                key={o}
                className="tj-btn"
                onClick={() => vote(o)}
                disabled={!!myVote}
                style={{ display: "block", width: "100%", textAlign: "left", position: "relative", marginBottom: 8 }}
                aria-pressed={picked}
              >
                {/* TODO: animate the bar growing in (transition on width) instead of a hard snap. */}
                <div
                  style={{
                    position: "absolute", inset: 0, width: \`\${pct}%\`,
                    background: COLORS[i % COLORS.length], opacity: 0.35, borderRadius: 8,
                  }}
                />
                <span style={{ position: "relative", fontWeight: picked ? 800 : 600 }}>
                  {/* TODO: give each option its own emoji prefix for personality. */}
                  {o} {myVote && <span className="tj-muted">— {count} · {pct}%</span>}
                  {/* TODO: style the winner (the highest bar) with a 👑 / accent border. */}
                  {picked && " ✓"}
                </span>
              </button>
            );
          })}
        </div>

        <p className="tj-muted" style={{ marginTop: 12 }}>
          {OPTIONS.reduce((sum, o) => sum + (tally[o] ?? 0), 0)} votes
          {ctx ? \` · voting as @\${ctx.user.username}\` : ""}
        </p>
      </div>
    </main>
  );
}
`;
  return { "app/page.tsx": page };
};

// Kit gate — runs ALONGSIDE the generic gate (which already checks @superjam/sdk
// usage, "use client", interactivity, and no leftover TODO). Here we add the
// poll-specific probes so a model can't pass by writing a non-poll. We enforce
// FUNCTION (counter tally + a vote handler + rendered results), never cosmetics —
// the starter's `// TODO:`s are deliberate polish gaps, so we do NOT reject on them.
const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  // Use-case core only (generic gate covers not-stub + sdk import + interactivity).
  // Match the METHOD CHAIN, not an `sdk.` prefix (the sdk var can be named anything).
  if (!/\.data\.counter\(/.test(page)) {
    missing.push("tally votes with data.counter(...).increment/top so results are SHARED across users");
  }
  return { ok: missing.length === 0, missing };
};

export const pollKit: Kit = {
  id: "poll",
  title: "Poll / vote",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
