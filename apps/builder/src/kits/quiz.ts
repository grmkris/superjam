// quiz — a use-case kit for timed quizzes / trivia: a question, tappable options,
// a per-question countdown, a score, a personal best (sdk.storage), and a shared
// verified-human leaderboard (sdk.data.counter). Like tap-arcade, the kit hand-
// holds the cheap build model: a tailored match, clarifying questions, a FILLED
// plan, a near-complete starter app/page.tsx with a few marked gaps, and a gate
// that rejects an unfilled stub.
//
// SDK CONTRACT — RECONCILED against what actually compiles+runs (NOT SDK.md's
// prop signature): SDK.md shows `export default function App({ sdk, ctx })` with
// props injected by the host. But the generated skeleton (generate.ts `page()`)
// and EVERY known-good build instead use a "use client" default-export page that
// obtains the sdk itself:
//   import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
//   const sdk = await SuperJam.connect();   // inside a useEffect
//   const ctx = sdk.app.context();          // synchronous, after connect
// That self-connect pattern is what the Next skeleton mounts + what builds green,
// so the starter below follows it. `counter.increment(key, n) → number`,
// `counter.top(n) → {key,value}[]`, `storage.get<T>(key) → T|null`,
// `storage.set(key, val)`.
//
// QUIZ RULES (from recipes/quiz.md): ALWAYS ship a local fallback question bank;
// lock the options after the first tap and reveal correct (green) / wrong (red);
// close the loop on a correct answer with counter("scores").increment + top(10),
// highlighting the player's own row.
import type { AppSpec } from "@superjam/shared";
import type { GateResult, Kit, KitContext } from "./types.ts";

// Mirrors selectRecipes' keyword heuristic: the name/description/features read
// like a quiz / trivia / test-your-knowledge / flashcard game.
const QUIZ_RE = /quiz|trivia|test your|how well|guess|questions?|flashcard/i;

const match = (spec: AppSpec): boolean => {
  const hay = `${spec.name} ${spec.description} ${spec.features.join(" ")}`;
  return QUIZ_RE.test(hay);
};

const questions: Kit["questions"] = [
  {
    q: "Where do the questions come from?",
    options: [
      "A fixed hand-authored bank",
      "AI-generated, fresh each round",
      "A specific topic/subject",
      "User-submitted",
    ],
  },
  {
    q: "How long does the player get per question?",
    options: ["No timer — take your time", "5 seconds", "10 seconds", "20 seconds"],
  },
  {
    q: "How is the score worked out?",
    options: ["1 point per correct", "10 points per correct", "Speed bonus for fast answers", "Streak multiplier"],
  },
];

// Pick the spec's first declared counter/storage names so the plan + starter wire
// the EXACT keys the spec promised; fall back to sensible quiz defaults.
const counterName = (spec: AppSpec): string => spec.data.counters[0]?.name ?? "scores";
const storageKey = (spec: AppSpec): string => spec.data.storage[0]?.key ?? "best";

const plan = (spec: AppSpec): string => {
  const emoji = spec.iconEmoji;
  const counter = counterName(spec);
  const store = storageKey(spec);
  const feats = spec.features.length
    ? spec.features.map((f) => `   - ${f}`).join("\n")
    : "   - (no extra features declared — keep it a tight quiz loop)";
  return `# Build plan — ${emoji} ${spec.name} (quiz / trivia)

1. Ship a LOCAL question bank front-and-center: a \`const BANK: Q[]\` where
   \`Q = { q: string; options: string[]; correctIndex: number }\` with 2-3 real,
   hand-authored questions. This is the source of truth — NEVER block first render
   on the network. (If you generate questions with \`sdk.ai.chat({ json: true })\`,
   validate defensively and fall back to BANK.)
2. Connect on mount: \`const sdk = await SuperJam.connect()\` inside a useEffect,
   then \`sdk.app.context()\` for the player. Load the personal best from
   \`sdk.storage.get<number>("${store}")\` (null ⇒ 0) and the leaderboard from
   \`sdk.data.counter("${counter}").top(10)\`. Show a loading state until ready.
3. Render the CURRENT question, its tappable options, and a per-question countdown
   (a \`setInterval\` ticking a \`timeLeft\` state down to 0).
4. On tap: LOCK the options (ignore further taps), REVEAL the result — paint the
   correct option green (#2FD180) and, if wrong, the picked option red (#E5484D).
   If correct, bump the running score.
5. If the timer hits 0 before a tap, lock + reveal as a miss (no points), then
   advance.
6. On the LAST question / game over: persist the personal best via
   \`sdk.storage.set("${store}", best)\` when beaten, and credit the shared board
   with \`sdk.data.counter("${counter}").increment(ctx.user.username, score)\`.
7. Show the leaderboard from \`top(10)\`, highlighting the row where
   \`key === ctx.user.username\` (every score is one verified human).
8. Wire the spec's specifics:
${feats}
9. Acceptance: answering reveals correct/wrong and locks the options, the score
   survives a reload (storage best), and the player appears on the global
   leaderboard (counter).`;
};

// A near-complete, TYPE-CORRECT starter. It compiles as-is (the gaps are visual /
// styling / content, not type holes) and follows the self-connect pattern proven
// by the known-good builds. The model fills the `// TODO:` gaps.
const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const counter = counterName(spec);
  const store = storageKey(spec);
  const page = `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

// ${title} — a timed quiz. Personal best persists in sdk.storage("${store}");
// the shared leaderboard is sdk.data.counter("${counter}").
type Q = { q: string; options: string[]; correctIndex: number };

// LOCAL fallback bank — the source of truth. Never block first render on the
// network. TODO: expand the bank (more questions) and/or tailor it to the topic.
const BANK: Q[] = [
  { q: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Mercury"], correctIndex: 1 },
  { q: "How many continents are there on Earth?", options: ["5", "6", "7", "8"], correctIndex: 2 },
  { q: "What is the largest ocean?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correctIndex: 3 },
];

const PER_QUESTION_SECONDS = 10;

export default function Page() {
  const [sdk, setSdk] = useState<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [timeLeft, setTimeLeft] = useState(PER_QUESTION_SECONDS);
  const [done, setDone] = useState(false);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const scoreRef = useRef(0);

  const current = BANK[idx];
  const me = ctx?.user.username ?? "you";

  // Connect once, then load the personal best + leaderboard (self-connect pattern).
  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect();
      setSdk(s);
      setCtx(s.app.context());
      setBest((await s.storage.get<number>("${store}")) ?? 0);
      setBoard(await s.data.counter("${counter}").top(10));
      setLoading(false);
    })();
  }, []);

  // Per-question countdown: tick down; on 0 (no answer yet) lock as a miss.
  useEffect(() => {
    if (loading || done || picked != null) return;
    if (timeLeft <= 0) {
      setPicked(-1); // -1 = timed out / locked with no pick
      return;
    }
    const t = setTimeout(() => setTimeLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, picked, loading, done]);

  function answer(i: number) {
    if (picked != null || done || !current) return; // lock after the first tap
    setPicked(i);
    if (i === current.correctIndex) {
      const next = scoreRef.current + 1;
      scoreRef.current = next;
      setScore(next);
    }
  }

  async function nextQuestion() {
    if (idx + 1 < BANK.length) {
      setIdx(idx + 1);
      setPicked(null);
      setTimeLeft(PER_QUESTION_SECONDS);
      return;
    }
    // Game over: persist a new personal best + credit the shared leaderboard.
    setDone(true);
    if (sdk && ctx) {
      const finalScore = scoreRef.current;
      if (finalScore > best) {
        setBest(finalScore);
        await sdk.storage.set("${store}", finalScore);
      }
      await sdk.data.counter("${counter}").increment(ctx.user.username, finalScore);
      setBoard(await sdk.data.counter("${counter}").top(10));
    }
  }

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
        {!done && current ? (
          <>
            <div className="tj-row">
              <span className="tj-muted">Q{idx + 1}/{BANK.length}</span>
              {/* TODO: turn this into a visual countdown bar that drains as timeLeft falls. */}
              <span className="tj-badge">⏱ {timeLeft}s</span>
            </div>
            <p className="tj-sub">{current.q}</p>
            <ul className="tj-list">
              {current.options.map((opt, i) => {
                const locked = picked != null;
                const bg = !locked
                  ? undefined
                  : i === current.correctIndex
                    ? "#2FD180"
                    : i === picked
                      ? "#E5484D"
                      : undefined;
                return (
                  <li key={opt}>
                    {/* TODO: add a tap/reveal transition (fade or pop) when locked. */}
                    <button
                      className="tj-btn"
                      style={{ width: "100%", background: bg }}
                      disabled={locked}
                      onClick={() => answer(i)}
                    >
                      {opt}
                    </button>
                  </li>
                );
              })}
            </ul>
            {picked != null && (
              <button className="tj-btn" onClick={nextQuestion}>
                {idx + 1 < BANK.length ? "Next →" : "Finish"}
              </button>
            )}
            <div className="tj-stat">{score}</div>
            <p className="tj-muted">score</p>
          </>
        ) : (
          <>
            <p className="tj-sub">Done! You scored {score} (best {best}).</p>
            {/* TODO: a "play again" reset + a celebratory transition on a new best. */}
          </>
        )}
      </div>

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>Leaderboard 🏆</h2>
        <ul className="tj-list">
          {board.map((row) => (
            <li key={row.key} style={row.key === me ? { color: "var(--accent)", fontWeight: 800 } : undefined}>
              <b>@{row.key}</b> <span className="tj-muted">{row.value}</span>
            </li>
          ))}
          {board.length === 0 && <div className="tj-empty">No scores yet — play to be first!</div>}
        </ul>
      </div>
    </main>
  );
}
`;
  return { "app/page.tsx": page };
};

// Kit gate — runs ALONGSIDE the generic gate (which already checks @superjam/sdk
// usage, "use client", interactivity, and no leftover TODO). Here we add the
// quiz-specific probes so a model can't pass by writing a non-quiz. We do NOT
// check for leftover // TODO — the starter's TODOs are cosmetic polish; the gate
// enforces FUNCTION (counter + answer handler + question bank + state), not
// finishing every flourish.
const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  if (!/sdk\.data\.counter\(/.test(page)) {
    missing.push("use sdk.data.counter(...) for the shared verified-human leaderboard (increment + top)");
  }
  if (!/\bon[A-Z]\w+\s*=/.test(page)) {
    missing.push("wire an answer handler (e.g. onClick) on each tappable option");
  }
  if (!/\b(BANK|QUESTIONS|questions)\b/.test(page) || !/\[\s*{/.test(page)) {
    missing.push("ship a LOCAL question bank — an array of { q, options, correctIndex } questions");
  }
  if (!/\buseState\b/.test(page)) {
    missing.push("drive the quiz with React state (useState) — current question, picked option, score, timer");
  }
  return { ok: missing.length === 0, missing };
};

export const quizKit: Kit = {
  id: "quiz",
  title: "Quiz / trivia",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
