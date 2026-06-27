// Seed jam — Mascot Draw-off (canvas → files.upload → ai.chat image judging →
// counter leaderboard + gallery). AI grades the ARTIFACT, never a person.
import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext, Doc } from "@superjam/sdk";

const PROMPT = "a happy World Cup mascot";

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const entries = sdk.data.collection("entries");
  const scores = sdk.data.counter("scores");
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [gallery, setGallery] = useState<Doc[]>([]);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);
  const [last, setLast] = useState<string>("");

  async function refresh() {
    setGallery((await entries.list({ orderBy: { field: "score", dir: "desc" }, limit: 12 })).docs);
    setBoard(await scores.top(10));
  }
  useEffect(() => { void refresh(); }, []);

  function point(e: React.PointerEvent) {
    if (!drawing.current) return;
    const c = cv.current; if (!c) return;
    const r = c.getBoundingClientRect();
    const g = c.getContext("2d")!;
    g.fillStyle = "#18151D";
    g.beginPath();
    g.arc(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height, 5, 0, 7);
    g.fill();
  }
  function clear() { const g = cv.current?.getContext("2d"); if (g && cv.current) g.clearRect(0, 0, cv.current.width, cv.current.height); }

  async function submit() {
    setBusy(true);
    setLast("");
    try {
      const url = (await sdk.files.upload(cv.current!.toDataURL("image/png"))).url;
      const { text } = await sdk.ai.chat(
        [{ role: "user", content:
          `This is a child-friendly drawing of "${PROMPT}". Score 0-10 for creativity and effort. ` +
          `Reply EXACTLY as "N — one witty sentence". Judge only the drawing, never a person.` }],
        { images: [url] },
      );
      const n = Math.max(0, Math.min(10, parseInt(text, 10) || 0));
      const reason = text.includes("—") ? text.slice(text.indexOf("—") + 1).trim() : "Nice work!";
      await entries.insert({ url, score: n, reason });
      await scores.increment(me, n);
      setLast(`${n}/10 — ${reason}`);
      sfx.win();
      if (n >= 8) confetti();
      await refresh();
    } catch {
      sdk.ui.toast("Judge is busy — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Draw: {PROMPT} 🎨</h1>
      <p className="tj-sub">The AI judge scores your masterpiece.</p>
      <canvas ref={cv} width={320} height={220}
        style={{ border: "2px solid var(--text)", borderRadius: 12, touchAction: "none", width: "100%", background: "#fff" }}
        onPointerDown={(e) => { drawing.current = true; point(e); }}
        onPointerMove={point}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)} />
      <div className="tj-row" style={{ marginTop: 8 }}>
        <button className="tj-btn tj-btn-ghost" onClick={clear} disabled={busy}>Clear</button>
        <button className="tj-btn" onClick={submit} disabled={busy} style={{ marginLeft: "auto" }}>
          {busy ? "Judging…" : "Submit"}
        </button>
      </div>
      {last && <p className="tj-badge" style={{ marginTop: 10 }}>{last}</p>}

      <h2 className="tj-sub" style={{ marginTop: 16, marginBottom: 4 }}>🏅 Top artists</h2>
      <ul className="tj-list">
        {board.map((r) => (
          <li key={r.key} style={r.key === me ? { color: "var(--accent)" } : undefined}>
            <b>@{r.key}</b><span className="tj-muted" style={{ marginLeft: "auto" }}>{r.value}</span>
          </li>
        ))}
      </ul>

      {gallery.length > 0 && (
        <div className="tj-grid2" style={{ marginTop: 12 }}>
          {gallery.map((d) => (
            <div key={d.id} className="tj-card" style={{ padding: 8, maxWidth: "unset" }}>
              <img src={String(d.data.url)} alt="" style={{ width: "100%", borderRadius: 8, display: "block" }} />
              <div className="tj-badge" style={{ marginTop: 6 }}>{String(d.data.score)}/10</div>
              <p className="tj-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{String(d.data.reason)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
