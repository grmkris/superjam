# SKILL judge — AI-judged contests (drawings, outfits, photos)

The killer SuperJam loop: users submit an **artifact** (a canvas drawing, a
camera photo, an uploaded image), the AI grades it against a rubric YOU state,
and the scores feed a leaderboard. Deps: `sdk.files.upload`, `sdk.ai.chat`
(multimodal), `sdk.data.collection` (the gallery), `sdk.data.counter` (the
board), `canvas-confetti`, `./lib/sfx`.

## HARD RULES (read these — they are the difference between charming and creepy)
1. **Judge ARTIFACTS, never people.** Grade the drawing / outfit / dish / photo
   composition against a rubric. NEVER score a person's looks, body, age, or any
   identity trait. Wholesome prompts only.
2. **Always show the score AND the model's one-line reason.** A bare number
   feels arbitrary; the witty reason is the fun.
3. The submitted image MUST be a `sdk.files.upload` URL (or a dataURL) — pass it
   to `sdk.ai.chat({ images: [url] })`. Magic-byte sniffed server-side.
4. Force a parseable verdict: ask for `"N — reason"` or `json:true`, then read
   defensively (the model can wander). Clamp N to 0–10.
5. AI calls take seconds and are quota'd (~25/user/day) — judge on submit, show
   a spinner, never in a loop.

## Three ways to get an artifact
- **Upload / camera**: `<input type="file" accept="image/*" capture="environment">`
  → FileReader → `sdk.files.upload(dataUrl)`. `capture` opens the phone camera.
- **Canvas draw**: a `<canvas>` with pointer events → `canvas.toDataURL("image/png")`
  → `sdk.files.upload`. (Draw-the-prompt games — no upload needed.)
- **Screenshot / share-card**: render your UI to canvas → `toDataURL` → upload.

## The pattern — a drawing contest with AI scoring + leaderboard

```tsx
import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext, Doc } from "@superjam/sdk";

const PROMPT = "a happy World Cup mascot";   // what everyone draws

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [gallery, setGallery] = useState<Doc[]>([]);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);
  const entries = sdk.data.collection("entries");
  const scores = sdk.data.counter("scores");

  const refresh = async () => {
    setGallery((await entries.list({ orderBy: { field: "score", dir: "desc" }, limit: 20 })).docs);
    setBoard(await scores.top(10));
  };
  useEffect(() => { void refresh(); }, []);

  // minimal finger-paint
  const draw = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = cv.current!, r = c.getBoundingClientRect(), g = c.getContext("2d")!;
    g.fillStyle = "#221A33";
    g.beginPath(); g.arc(e.clientX - r.left, e.clientY - r.top, 4, 0, 7); g.fill();
  };

  async function submit() {
    setBusy(true);
    try {
      const dataUrl = cv.current!.toDataURL("image/png");
      const { url } = await sdk.files.upload(dataUrl);
      const { text } = await sdk.ai.chat(
        [{ role: "user", content:
          `This is a child-friendly drawing of "${PROMPT}". Score it 0-10 on creativity and effort. ` +
          `Reply EXACTLY as "N — one witty sentence". Judge only the drawing, never any person.` }],
        { images: [url] },
      );
      const n = Math.max(0, Math.min(10, parseInt(text, 10) || 0));
      const reason = text.split("—").slice(1).join("—").trim() || "Nice work!";
      await entries.insert({ url, score: n, reason });
      await scores.increment(me, n);
      sfx.win(); if (n >= 8) confetti();
      await refresh();
    } catch { sdk.ui.toast("Judge is busy — try again"); }
    finally { setBusy(false); }
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Draw: {PROMPT} 🎨</h1>
      <p className="tj-sub">The AI judge scores your masterpiece.</p>
      <canvas ref={cv} width={320} height={220}
        style={{ border: "2px solid var(--text)", borderRadius: 12, touchAction: "none", width: "100%" }}
        onPointerDown={(e) => { drawing.current = true; draw(e); }}
        onPointerMove={draw} onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)} />
      <div className="tj-row" style={{ marginTop: 8 }}>
        <button className="tj-btn tj-btn-ghost" onClick={() => cv.current!.getContext("2d")!.clearRect(0, 0, 320, 220)}>Clear</button>
        <button className="tj-btn" disabled={busy} onClick={submit}>{busy ? "Judging…" : "Submit"}</button>
      </div>
      <h2 className="tj-sub" style={{ marginTop: 16 }}>Top artists</h2>
      <ul className="tj-list">
        {board.map((r) => (
          <li key={r.key} style={r.key === me ? { color: "var(--accent)" } : undefined}>
            <b>@{r.key}</b> <span className="tj-muted" style={{ marginLeft: "auto" }}>{r.value}</span>
          </li>
        ))}
      </ul>
      <div className="tj-grid2" style={{ marginTop: 12 }}>
        {gallery.map((d) => (
          <div key={d.id} className="tj-card" style={{ padding: 8 }}>
            <img src={String(d.data.url)} alt="" style={{ width: "100%", borderRadius: 8 }} />
            <div className="tj-badge">{String(d.data.score)}/10</div>
            <p className="tj-muted" style={{ fontSize: 12 }}>{String(d.data.reason)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Variants: outfit/cosplay photo contest (camera capture), "best dish" food
photos, caption-the-image (text judged by `ai.chat` without images). Always
state the rubric in the prompt and surface the reason.

## Secret-dealing recipe (hidden roles, private prompts)
For games where each player needs a PRIVATE assignment (werewolf, secret-Santa,
"draw what I whisper"), deal it via `sdk.messages.send({ to, data })` — `data` is
recipient-only (never `text`, which shows in the inbox). The host/creator picks
assignments and messages each player their secret; players read it from
`sdk.messages.list()`.
