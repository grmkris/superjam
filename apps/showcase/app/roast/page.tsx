"use client";

// Roast My Bags — paste your holdings, Gemini roasts them (real AI, even in
// DEMO_MODE), the roast is saved to a shared collection, and the crowd 😂-votes
// the funniest via a counter. Pure AI + data — no payment/onchain rails.
import type { Doc, Json, SuperJamSdk } from "../../lib/superjam-sdk";
import { useEffect, useState } from "react";
import { JamPage } from "../../lib/jam";

const SAMPLES: { label: string; bags: string }[] = [
  { label: "🐸 Degen", bags: "PEPE 4,200,000 · DOGE 50,000 · SHIB 9,000,000 · 0.2 ETH" },
  { label: "💎 Diamond hands", bags: "1.5 BTC (bought 2017, never sold) · 12 ETH" },
  { label: "🤡 Top blaster", bags: "LUNA 500 · FTT 80 · SafeMoon 1,000,000" },
  { label: "🏦 Boomer", bags: "5,000 USDC · 0.05 BTC · stables only fr" },
];

const asObj = (v: Json | null): Record<string, Json> =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

interface Roast {
  roast: string;
  cope: number;
  title: string;
}

function RoastApp({ sdk }: { sdk: SuperJamSdk }) {
  const roasts = sdk.data.collection("roasts");
  const laughs = sdk.data.counter("laughs");

  const [bags, setBags] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Roast | null>(null);
  const [feed, setFeed] = useState<Doc[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});

  async function refresh() {
    const [{ docs }, top] = await Promise.all([roasts.list({ limit: 50 }), laughs.top(200)]);
    const map: Record<string, number> = {};
    for (const t of top) map[t.key] = t.value;
    setScores(map);
    docs.sort((a, b) => (map[b.id] ?? 0) - (map[a.id] ?? 0));
    setFeed(docs);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, []);

  async function roastMe() {
    if (!bags.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const { text } = await sdk.ai.chat(
        [
          {
            role: "system",
            content:
              "You are a savage-but-playful crypto portfolio roaster. Given someone's holdings, " +
              "reply ONLY as JSON: {\"title\": a 2-4 word nickname for this investor, " +
              "\"roast\": a punchy 1-2 sentence roast (funny, not mean, emoji ok), " +
              "\"cope\": an integer 0-100 cope score (how hard they're coping). No prose outside JSON.",
          },
          { role: "user", content: `Holdings: ${bags.trim()}` },
        ],
        { json: true }
      );
      let r: Roast;
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        r = {
          roast: String(j.roast ?? "Couldn't find words. That's a roast in itself."),
          cope: Math.max(0, Math.min(100, Number(j.cope) || 50)),
          title: String(j.title ?? "Mystery Bag"),
        };
      } catch {
        r = { roast: text.slice(0, 240), cope: 50, title: "Mystery Bag" };
      }
      setResult(r);
      const { id } = await roasts.insert({ bags: bags.trim(), ...r });
      await laughs.increment(id, 0); // register the row at 0 laughs
      await refresh();
    } catch {
      sdk.ui.toast("the roaster choked — try again");
    } finally {
      setBusy(false);
    }
  }

  async function laugh(id: string) {
    setScores((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }));
    await laughs.increment(id, 1);
  }

  return (
    <div className="sj-wrap">
      <div className="tj-card">
        <h1 className="tj-title">🔥 Roast My Bags</h1>
        <p className="tj-sub">Paste your holdings. Our AI has no chill.</p>

        <div className="tj-row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
          {SAMPLES.map((s) => (
            <button key={s.label} className="tj-pill" onClick={() => setBags(s.bags)}>
              {s.label}
            </button>
          ))}
        </div>

        <textarea
          className="tj-input"
          rows={3}
          style={{ resize: "none" }}
          placeholder="e.g. 2 ETH · 50,000 DOGE · 1,000 USDC"
          value={bags}
          onChange={(e) => setBags(e.target.value)}
        />
        <button
          className="tj-btn"
          style={{ width: "100%", marginTop: 10 }}
          onClick={roastMe}
          disabled={busy || !bags.trim()}
        >
          {busy ? "cooking… 🔥" : "Roast me →"}
        </button>

        {result && (
          <div className="tj-card tj-pop" style={{ marginTop: 14, background: "var(--bg)" }}>
            <span className="tj-badge">{result.title}</span>
            <p style={{ fontWeight: 700, margin: "10px 0" }}>{result.roast}</p>
            <CopeMeter value={result.cope} />
          </div>
        )}
      </div>

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>😂 Funniest roasts</h2>
        <p className="tj-sub">Tap 😂 to upvote.</p>
        <ul className="tj-list">
          {feed.map((d) => {
            const data = asObj(d.data);
            return (
              <li key={d.id} style={{ alignItems: "flex-start", gap: 10 }}>
                <button className="tj-pill" onClick={() => laugh(d.id)}>
                  😂 {scores[d.id] ?? 0}
                </button>
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{String(data.title ?? "Bag")}</b>{" "}
                  <span className="tj-muted" style={{ fontSize: 12 }}>· @{d.username}</span>
                  <div style={{ fontSize: 13 }}>{String(data.roast ?? "")}</div>
                </span>
              </li>
            );
          })}
          {feed.length === 0 && <div className="tj-empty">No roasts yet — go first 🔥</div>}
        </ul>
        {sdk.standalone && (
          <p className="tj-muted" style={{ fontSize: 12, marginTop: 8 }}>
            (preview — open in SuperJam to save & vote)
          </p>
        )}
      </div>
    </div>
  );
}

function CopeMeter({ value }: { value: number }) {
  const color = value > 66 ? "var(--danger)" : value > 33 ? "#FFC940" : "#2FD180";
  return (
    <div>
      <div className="tj-row" style={{ justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
        <span>cope-o-meter</span>
        <span>{value}/100</span>
      </div>
      <div style={{ height: 12, background: "#fff", border: "2px solid var(--text)", borderRadius: 999, overflow: "hidden", marginTop: 4 }}>
        <div style={{ width: `${value}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

export default function Page() {
  return <JamPage render={(sdk) => <RoastApp sdk={sdk} />} />;
}
