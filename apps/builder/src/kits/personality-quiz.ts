// personality-quiz — the "Which ___ are you?" viral kit. Answer a few questions →
// a result TYPE with a shareable card. The classic BuzzFeed loop: the result is
// personal + the share-link ("@x is a Trailblazer — what are you?") pulls friends in.
// Zero-backend: sdk.storage (your result) + sdk.data.counter (type distribution) +
// sdk.share.link (the viral loop). Seeds the shared result-card component.
import type { AppSpec } from "@superjam/shared";
import { resultCardComponent } from "./_share.ts";
import type { GateResult, Kit, KitContext } from "./types.ts";

const RE = /which .* are you|what (?:kind|type|sort) of .* are you|what'?s your .*(type|spirit|vibe)|personality|are you a |buzzfeed/i;
const match = (spec: AppSpec): boolean =>
  RE.test(`${spec.name} ${spec.description} ${spec.features.join(" ")}`);

const questions: Kit["questions"] = [
  { q: "How many result types?", options: ["3 types", "4 types (classic)", "5–6 types"] },
  { q: "What flavor are the questions?", options: ["Silly / chaotic", "Wholesome", "Spicy hot-takes", "Aesthetic / vibe"] },
  { q: "Show how rare your result is?", options: ["Yes — '12% are this'", "No — just the result"] },
];

const plan = (spec: AppSpec): string => `# Build plan — ${spec.iconEmoji} ${spec.name} (personality quiz)

A working starter is seeded (QUESTIONS + TYPES + the share loop). Make it land for
"${spec.name}".

1. REWRITE \`QUESTIONS\` + \`TYPES\` to fit the theme — 4–6 fun questions, 3–5 result
   types each with an emoji + a punchy one-line blurb. Every choice maps to a type.
2. Tally the picks; the winning type is the result. Persist it in
   \`sdk.storage.set("myType", type)\` and credit \`sdk.data.counter("types").increment(type)\`
   so you can show how rare a result is (share of the counter total).
3. End on the seeded \`<ResultCard>\` — emoji + "You're a {type}!" + the blurb. Below it a
   "Share your result" button that calls \`shareResult(sdk, { text, data })\` (the deep-link
   carries {type, who}); and a "Retake" button.
4. On open, \`readChallenge(sdk)\` returns a friend's {type, who} when launched from a
   share — show "@friend is a {type} — which are you?" to pull them in.
5. Keep it Studio (near-white, .tj-* classes). Wire the spec's specifics:
${spec.features.length ? spec.features.map((f) => `   - ${f}`).join("\n") : "   - (invent fun, on-theme questions + types)"}
6. Acceptance: finishing the quiz shows a result card, the share button produces a
   link, and the result persists across a reload.`;

const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const page = `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";
import { ResultCard, shareResult, readChallenge } from "@/components/result-card";

// ${title} — a personality quiz. Answer a few Qs → a shareable result TYPE.
// TODO: rewrite QUESTIONS + TYPES to fit "${title}" (4–6 Qs, 3–5 types, on-theme).
type Choice = { label: string; type: string };
type Q = { q: string; choices: Choice[] };

const TYPES: Record<string, { emoji: string; blurb: string }> = {
  Trailblazer: { emoji: "🚀", blurb: "You charge ahead and drag everyone into the fun." },
  Dreamer: { emoji: "🌈", blurb: "Head in the clouds, heart full of big ideas." },
  Rock: { emoji: "🪨", blurb: "Calm, steady — the one everyone leans on." },
  Wildcard: { emoji: "🃏", blurb: "Nobody, including you, knows what's next." },
};
const QUESTIONS: Q[] = [
  { q: "Pick a weekend:", choices: [
    { label: "Spontaneous road trip", type: "Trailblazer" },
    { label: "Sketching new ideas", type: "Dreamer" },
    { label: "Cozy and low-key", type: "Rock" },
    { label: "Whatever happens, happens", type: "Wildcard" } ] },
  { q: "Friends call you the…", choices: [
    { label: "Ringleader", type: "Trailblazer" },
    { label: "Visionary", type: "Dreamer" },
    { label: "Anchor", type: "Rock" },
    { label: "Chaos goblin", type: "Wildcard" } ] },
  { q: "A problem appears. You:", choices: [
    { label: "Charge at it", type: "Trailblazer" },
    { label: "Reimagine it", type: "Dreamer" },
    { label: "Steady the ship", type: "Rock" },
    { label: "Improvise wildly", type: "Wildcard" } ] },
];

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [idx, setIdx] = useState(0);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [result, setResult] = useState<string | null>(null);
  const [friend, setFriend] = useState<{ type: string; who: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect();
      sdkRef.current = s; setCtx(s.app.context());
      const prior = await s.storage.get<string>("myType");
      if (prior) setResult(prior);
      const ch = readChallenge<{ type?: string; who?: string }>(s);
      if (ch && typeof ch.type === "string") setFriend({ type: String(ch.type), who: String(ch.who ?? "A friend") });
      setLoading(false);
    })();
  }, []);

  async function pick(type: string) {
    const next = { ...tally, [type]: (tally[type] ?? 0) + 1 };
    setTally(next);
    if (idx + 1 < QUESTIONS.length) { setIdx(idx + 1); return; }
    const winner = Object.entries(next).sort((a, b) => b[1] - a[1])[0]?.[0] ?? Object.keys(TYPES)[0] ?? "Wildcard";
    setResult(winner);
    const s = sdkRef.current;
    if (s) { await s.storage.set("myType", winner); await s.data.counter("types").increment(winner, 1); }
  }
  function reset() { setIdx(0); setTally({}); setResult(null); }

  if (loading) return (<main className="tj-app tj-center"><div className="tj-card"><div className="tj-spin" /></div></main>);

  if (result) {
    const info = TYPES[result] ?? { emoji: "✨", blurb: "" };
    const s = sdkRef.current;
    const me = ctx?.user.username ?? "";
    return (
      <main className="tj-app">
        <ResultCard emoji={info.emoji} title={"You're a " + result + "!"} subtitle={info.blurb}>
          <div className="tj-row" style={{ gap: 8, marginTop: 14 }}>
            <button className="tj-btn tj-btn-block" onClick={() => { if (s) shareResult(s, { text: "@" + me + " is a " + result + " — what are you?", data: { type: result, who: me } }); }}>Share your result 🔗</button>
            <button className="tj-btn tj-btn-ghost" onClick={reset}>Retake</button>
          </div>
        </ResultCard>
      </main>
    );
  }

  const q = QUESTIONS[idx];
  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${emoji}</span>
          <div className="tj-htext">
            <h1 className="tj-title">${title}</h1>
            <p className="tj-sub">{friend ? friend.who + " is a " + friend.type + " — which are you?" : "Question " + (idx + 1) + " of " + QUESTIONS.length}</p>
          </div>
        </div>
        {q ? (
          <>
            <p style={{ fontWeight: 700, margin: "4px 0 12px" }}>{q.q}</p>
            <div className="tj-choices">
              {q.choices.map((c) => (
                <button key={c.label} className="tj-choice" onClick={() => pick(c.type)}>{c.label}</button>
              ))}
            </div>
          </>
        ) : null}
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
    missing.push("end on a shareable result — call shareResult(sdk, { text, data }) so players can share/challenge");
  }
  if (!/\.storage\.|\.data\.counter\(/.test(page)) {
    missing.push("persist the result with sdk.storage and/or tally types with sdk.data.counter");
  }
  return { ok: missing.length === 0, missing };
};

export const personalityQuizKit: Kit = {
  id: "personality-quiz",
  title: "Personality quiz",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
