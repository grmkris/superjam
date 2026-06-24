// daily-guess — a Wordle-like daily puzzle. One puzzle per day (seeded from the
// date), guess with green/yellow/gray feedback, keep a streak, and share the
// SPOILER-FREE emoji grid ("Daily 3/6 🟩🟩🟩") — the exact mechanic that made
// Wordle spread. Zero-backend: sdk.storage (streak + today's state) +
// sdk.data.counter (global guess distribution) + sdk.share.link. Seeds result-card.
import type { AppSpec } from "@superjam/shared";
import { resultCardComponent } from "./_share.ts";
import type { GateResult, Kit, KitContext } from "./types.ts";

// Specific to word/daily-guess games so it doesn't grab generic "daily trivia" (quiz)
// or "doodle guessing" (a draw game).
const RE = /wordle|five.?letter|word game|guess the word|daily (?:word|puzzle|challenge|guess)|word(?:le)? puzzle|\bstreak\b|\briddle\b/i;
const match = (spec: AppSpec): boolean =>
  RE.test(`${spec.name} ${spec.description} ${spec.features.join(" ")}`);

const questions: Kit["questions"] = [
  { q: "What's the daily puzzle?", options: ["Guess a 5-letter word", "Guess an emoji/flag", "Guess a number/price"] },
  { q: "How many tries?", options: ["6 (Wordle classic)", "3 (hard)", "Unlimited (casual)"] },
];

const plan = (spec: AppSpec): string => `# Build plan — ${spec.iconEmoji} ${spec.name} (daily guess)

A working Wordle-style starter is seeded (daily word from the date + feedback + streak
+ spoiler-free emoji-grid share).

1. The Wordle logic in the starter (\`scoreGuess\`, the board, the daily-word pick, the
   streak/storage, the emoji-grid share) is COMPLETE and CORRECT. Change ONLY two things:
   (a) the \`WORDS\` array — wholesome 5-letter UPPERCASE words on-theme; (b) the visual
   theme/copy. Do NOT restructure the game logic, the state, or the component order
   (rewriting it tends to break the build) — extend, don't rewrite.
2. The loop already does 6 tries + per-letter feedback (🟩/🟨/⬜) + streak in
   \`sdk.storage\` (one play/day). Keep it.
3. On finish, bump \`sdk.data.counter("tries").increment(String(n))\` for a global "most
   got it in N" distribution.
4. End on the seeded \`<ResultCard>\` with the SPOILER-FREE emoji grid + the streak, and a
   "Share" button: \`shareResult(sdk, { text:"Daily 3/6 🟩…", data:{ n, grid } })\` — never
   leak the answer in the shared text.
5. Theme it (Toybox). Wire the spec's specifics:
${spec.features.length ? spec.features.map((f) => `   - ${f}`).join("\n") : "   - (a tight daily guess + streak loop)"}
6. Acceptance: a guess shows colored feedback, winning bumps the streak (persisted), and
   the share button produces the emoji grid without revealing the word.`;

const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const page = `"use client";

import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";
import { ResultCard, shareResult } from "@/components/result-card";

// ${title} — a daily word guess. Same word for everyone each day; share the grid.
// TODO: rewrite WORDS on-theme (wholesome 5-letter words, UPPERCASE).
const WORDS = ["TOAST", "PLANT", "GHOST", "BRAVE", "LEMON", "RIVER", "CANDY", "MAGIC"];
const MAX = 6;

const dayIndex = () => Math.floor(Date.now() / 86400000);
const answerOf = () => WORDS[dayIndex() % WORDS.length] ?? WORDS[0]!;

// Wordle two-pass scoring: 2 = green (right spot), 1 = yellow (in word), 0 = gray.
function scoreGuess(guess: string, answer: string): number[] {
  const a = answer.split(""); const g = guess.split("");
  const res = [0, 0, 0, 0, 0]; const used = [false, false, false, false, false];
  for (let i = 0; i < 5; i++) if (g[i] === a[i]) { res[i] = 2; used[i] = true; }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 2) continue;
    for (let j = 0; j < 5; j++) if (!used[j] && g[i] === a[j]) { res[i] = 1; used[j] = true; break; }
  }
  return res;
}
const EMOJI = ["⬜", "🟨", "🟩"];
const rowEmoji = (marks: number[]) => marks.map((m) => EMOJI[m] ?? "⬜").join("");

type Row = { word: string; marks: number[] };

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [streak, setStreak] = useState(0);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect(); sdkRef.current = s;
      setStreak((await s.storage.get<number>("streak")) ?? 0);
      const today = await s.storage.get<{ day: number; rows: Row[]; status: "playing" | "won" | "lost" }>("today");
      if (today && today.day === dayIndex()) { setRows(today.rows); setStatus(today.status); }
      setLoading(false);
    })();
  }, []);

  async function submit() {
    const g = input.trim().toUpperCase();
    if (status !== "playing" || g.length !== 5) return;
    const answer = answerOf();
    const marks = scoreGuess(g, answer);
    const nextRows = [...rows, { word: g, marks }];
    setRows(nextRows); setInput("");
    const won = g === answer;
    const lost = !won && nextRows.length >= MAX;
    const nextStatus = won ? "won" : lost ? "lost" : "playing";
    setStatus(nextStatus);
    const s = sdkRef.current;
    if (s) {
      await s.storage.set("today", { day: dayIndex(), rows: nextRows, status: nextStatus });
      if (won || lost) {
        const ns = won ? streak + 1 : 0; setStreak(ns);
        await s.storage.set("streak", ns);
        if (won) await s.data.counter("tries").increment(String(nextRows.length), 1);
      }
    }
  }

  if (loading) return (<main className="tj-app tj-center"><div className="tj-card"><div className="tj-spin" /></div></main>);

  if (status !== "playing") {
    const s = sdkRef.current;
    const grid = rows.map((r) => rowEmoji(r.marks)).join("\\n");
    const n = status === "won" ? rows.length : MAX;
    const head = "${title} " + (status === "won" ? n + "/" + MAX : "X/" + MAX);
    return (
      <main className="tj-app">
        <ResultCard emoji="${emoji}" title={status === "won" ? "Solved in " + n + "! 🎉" : "So close!"} subtitle={"🔥 " + streak + " day streak"}>
          <pre style={{ fontSize: 22, lineHeight: 1.15, margin: "8px 0", fontFamily: "inherit" }}>{grid}</pre>
          <button className="tj-btn tj-btn-block" onClick={() => { if (s) shareResult(s, { text: head + "\\n" + grid, data: { n, status } }); }}>Share your grid 🟩</button>
        </ResultCard>
      </main>
    );
  }

  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${emoji}</span>
          <div className="tj-htext"><h1 className="tj-title">${title}</h1><p className="tj-sub">🔥 {streak} day streak · {rows.length}/{MAX}</p></div>
        </div>
        <div className="tj-list">
          {rows.map((r, i) => (
            <div key={i} className="tj-row" style={{ gap: 6, justifyContent: "center" }}>
              {r.word.split("").map((ch, j) => (
                <span key={j} className="tj-badge" style={{ width: 38, height: 38, justifyContent: "center", fontSize: 18, color: "#fff", background: r.marks[j] === 2 ? "var(--green)" : r.marks[j] === 1 ? "var(--yellow)" : "var(--muted)" }}>{ch}</span>
              ))}
            </div>
          ))}
        </div>
        {/* TODO: an on-screen keyboard is nicer than a text field — add one with per-key colors. */}
        <input className="tj-input" style={{ marginTop: 12, textTransform: "uppercase", letterSpacing: 4, textAlign: "center" }} value={input} maxLength={5} placeholder="GUESS" onChange={(e) => setInput(e.target.value.replace(/[^A-Za-z]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button className="tj-btn tj-btn-block" style={{ marginTop: 10 }} disabled={input.trim().length !== 5} onClick={submit}>Guess</button>
      </div>
    </main>
  );
}
`;
  return { "components/result-card.tsx": resultCardComponent(), "app/page.tsx": page };
};

const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  if (!/shareResult\(|\.share\.link\(/.test(page)) {
    missing.push("end on a shareable spoiler-free emoji grid — call shareResult(sdk, { text, data })");
  }
  if (!/\.storage\./.test(page)) {
    missing.push("keep the streak + today's state in sdk.storage (one play per day, streak persists)");
  }
  return { ok: missing.length === 0, missing };
};

export const dailyGuessKit: Kit = {
  id: "daily-guess",
  title: "Daily guess",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
