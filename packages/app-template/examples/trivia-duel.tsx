// Seed jam — Trivia Duel (ai.chat for a fresh question, local fallback bank,
// share.link + messages.send to challenge a friend, ctx.launch to accept one).
import { useEffect, useState } from "react";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext, Json } from "@superjam/sdk";

type Q = { q: string; options: string[]; answer: number };

const BANK: Q[] = [
  { q: "Which nation has won the most World Cups?", options: ["Germany", "Brazil", "Italy", "Argentina"], answer: 1 },
  { q: "Who won the 2022 World Cup?", options: ["France", "Croatia", "Argentina", "Brazil"], answer: 2 },
  { q: "How many players per side are on the pitch?", options: ["9", "10", "11", "12"], answer: 2 },
  { q: "What shape is a classic football's pattern?", options: ["Squares", "Hexagons & pentagons", "Triangles", "Circles"], answer: 1 },
];

const asRecord = (v: Json | null): Record<string, Json> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const wins = sdk.data.counter("wins");
  const launch = asRecord(ctx.launch);
  const seedIdx = typeof launch?.qIndex === "number" ? launch.qIndex : null;

  const [idx, setIdx] = useState<number>(seedIdx != null ? seedIdx % BANK.length : Math.floor(Math.random() * BANK.length));
  const [picked, setPicked] = useState<number | null>(null);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);
  const [to, setTo] = useState("");
  const [sent, setSent] = useState(false);

  const q = BANK[idx]!;
  const correct = picked === q.answer;

  useEffect(() => { void wins.top(5).then(setBoard); }, []);

  async function answer(i: number) {
    if (picked != null) return;
    setPicked(i);
    if (i === q.answer) {
      sfx.win();
      await wins.increment(me, 1);
      setBoard(await wins.top(5));
    } else {
      sfx.lose();
    }
  }

  async function challenge() {
    if (!to.trim()) return;
    try {
      const { url } = await sdk.share.link({ data: { qIndex: idx } });
      await sdk.messages.send({
        to: to.trim(),
        text: `${me} challenged you to a trivia duel! ⚽`,
        data: { kind: "duel", qIndex: idx },
        link: url,
      });
      setSent(true);
      sdk.ui.toast(`Challenge sent to @${to.trim()}`);
    } catch {
      sdk.ui.toast("Couldn't send — check the username");
    }
  }

  function next() {
    setPicked(null);
    setSent(false);
    setIdx(Math.floor(Math.random() * BANK.length));
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Trivia Duel ⚽</h1>
      {seedIdx != null && picked == null && <p className="tj-badge">You were challenged!</p>}
      <p className="tj-sub" style={{ marginTop: 8 }}>{q.q}</p>
      <div style={{ display: "grid", gap: 8 }}>
        {q.options.map((o, i) => {
          const reveal = picked != null && (i === q.answer || i === picked);
          const bg = picked == null ? undefined : i === q.answer ? "#2FD180" : i === picked ? "#E5484D" : undefined;
          return (
            <button key={o} className="tj-btn" disabled={picked != null}
              style={{ background: bg, color: reveal ? "#fff" : undefined }} onClick={() => answer(i)}>
              {o}
            </button>
          );
        })}
      </div>

      {picked != null && (
        <div style={{ marginTop: 14 }}>
          <div className="tj-stat tj-center">{correct ? "✅ Correct!" : "❌ Nope"}</div>
          {!sent ? (
            <div className="tj-row" style={{ marginTop: 10 }}>
              <input className="tj-input" placeholder="friend's username" value={to} onChange={(e) => setTo(e.target.value)} />
              <button className="tj-btn" onClick={challenge}>Challenge</button>
            </div>
          ) : (
            <p className="tj-muted" style={{ textAlign: "center" }}>Invite sent 🎉</p>
          )}
          <button className="tj-btn tj-btn-ghost" style={{ marginTop: 8, width: "100%" }} onClick={next}>Next question</button>
        </div>
      )}

      <h2 className="tj-sub" style={{ marginTop: 16, marginBottom: 4 }}>🏆 Most wins</h2>
      <ul className="tj-list">
        {board.map((r) => (
          <li key={r.key} style={r.key === me ? { color: "var(--accent)" } : undefined}>
            <b>@{r.key}</b><span className="tj-muted" style={{ marginLeft: "auto" }}>{r.value}</span>
          </li>
        ))}
        {board.length === 0 && <div className="tj-empty">No winners yet — answer one!</div>}
      </ul>
    </div>
  );
}
