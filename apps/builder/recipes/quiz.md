# Recipe quiz — timed quizzes & trivia (zero-backend)

A question, tappable options, a per-question countdown, a score, and a verified-human
leaderboard. **Platform primitives only — no Neon, no API routes.** Uses
`sdk.data.counter("scores")` for the board and optionally `sdk.ai.chat` for fresh questions.
Manifest capability: `"ai"` only if you generate questions; add `"social"` for the
challenge-a-friend variant.

## RULES
1. Always ship a **local fallback bank** — `ai.chat` is slow, quota'd, and can return junk.
   Generate with `{ json: true }`, validate `q`/`options.length`/`answer` defensively, and
   fall back to a hand-authored `Q[]`. Never block first render on the model.
2. Lock options after the first tap; reveal correct (`#2FD180`) and wrong (`#E5484D`).
3. Close the loop: correct → `counter("scores").increment(username, pts)` → `top(10)`,
   highlight the row where `key === me`. (This is the World-ID "every score is one real
   human" story.)
4. Standalone-safe; render question/option text as plain text.

## Pattern — `app/page.tsx`

```tsx
"use client";
import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

type Q = { q: string; options: string[]; answer: number };
const FALLBACK: Q[] = [
  { q: "Which planet is the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Mercury"], answer: 1 },
  { q: "How many continents are there?", options: ["5", "6", "7", "8"], answer: 2 },
];

function parseQ(raw: string): Q | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const q = typeof o.q === "string" ? o.q : null;
    const options = Array.isArray(o.options) ? o.options.map(String) : null;
    const answer = typeof o.answer === "number" ? o.answer : null;
    if (q && options && options.length === 4 && answer != null && answer >= 0 && answer < 4)
      return { q, options, answer };
  } catch { /* fall through */ }
  return null;
}

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [me, setMe] = useState("");
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);

  useEffect(() => {
    (async () => {
      const sdk = await SuperJam.connect();
      sdkRef.current = sdk;
      setMe(sdk.app.context().user.username);
      setBoard(await sdk.data.counter("scores").top(10));
      await loadQ(sdk);
    })();
  }, []);

  async function loadQ(sdk: SuperJamSdk) {
    setPicked(null);
    setQ(null);
    let next: Q | null = null;
    try {
      const { text } = await sdk.ai.chat(
        [{ role: "user", content: 'One trivia question as JSON {"q":string,"options":string[4],"answer":number 0-3}. Short.' }],
        { json: true },
      );
      next = parseQ(text);
    } catch { /* offline → fallback */ }
    setQ(next ?? FALLBACK[Math.floor(Math.random() * FALLBACK.length)]!);
  }

  async function answer(i: number) {
    const sdk = sdkRef.current;
    if (picked != null || !q || !sdk) return;
    setPicked(i);
    if (i === q.answer) {
      await sdk.data.counter("scores").increment(me, 10);
      setBoard(await sdk.data.counter("scores").top(10));
    }
  }

  if (!q) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1>🧠 Quiz</h1>
      <p>{q.q}</p>
      <div style={{ display: "grid", gap: 8 }}>
        {q.options.map((o, i) => {
          const bg = picked == null ? "#fff" : i === q.answer ? "#2FD180" : i === picked ? "#E5484D" : "#fff";
          return (
            <button key={o} disabled={picked != null} onClick={() => answer(i)}
              style={{ padding: 12, borderRadius: 8, background: bg }}>{o}</button>
          );
        })}
      </div>
      {picked != null && sdkRef.current && (
        <button onClick={() => loadQ(sdkRef.current!)} style={{ marginTop: 12 }}>Next →</button>
      )}
      <h2 style={{ marginTop: 20 }}>🏆 Top scorers</h2>
      <ul>{board.map((r) => (
        <li key={r.key} style={r.key === me ? { fontWeight: 700 } : undefined}>@{r.key} — {r.value}</li>
      ))}</ul>
    </main>
  );
}
```

## Variants
- **Curated bank** — drop `ai.chat` entirely (no `"ai"` capability); ship a fixed `Q[]`.
- **Challenge a friend** (`"social"`) — `sdk.share.link({ data:{ qIndex } })` →
  `sdk.messages.send({ to, text, link })`; the opener reads `sdk.app.context().launch`.
- **Timed** — add a `setInterval` countdown; award a speed bonus on correct.
- **Daily streak** — persist the user's streak in `sdk.storage`.
