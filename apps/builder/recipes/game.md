# Recipe game — arcade / clicker with a high-score board (zero-backend)

A playable 2D (or 3D) game with a verified-human high-score leaderboard. **Prefer plain
`<canvas>`** — no extra npm deps → faster, more reliable deploys. Scores via
`sdk.data.counter("scores")`. Capability: none (add `"ai"` only for flavor text).

## RULES
1. All moving state lives in a **ref**, mutated inside a `requestAnimationFrame` loop — never
   `setState` per frame. Sync to React state only on score change / game over.
2. Controls: keyboard **and** on-screen touch buttons (phones can't use a keyboard).
3. Close the loop: game over → `sdk.data.counter("scores").increment(username, score)` →
   render `top(10)`, highlight the player's row.
4. Standalone-safe; no external assets (emoji + shapes only).

## Pattern — `app/page.tsx` (2D canvas, no deps)

```tsx
"use client";
import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const world = useRef({ x: 160, score: 0, over: false /* + sprites… */ });
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);
  const [score, setScore] = useState(0);

  useEffect(() => {
    (async () => {
      const sdk = await SuperJam.connect();
      sdkRef.current = sdk;
      setBoard(await sdk.data.counter("scores").top(10));
    })();
    let raf = 0;
    const loop = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) { /* update world.current, draw sprites, detect collisions */ }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function gameOver() {
    const sdk = sdkRef.current; if (!sdk) return;
    const me = sdk.app.context().user.username;
    await sdk.data.counter("scores").increment(me, world.current.score);
    setBoard(await sdk.data.counter("scores").top(10));
    setScore(world.current.score);
  }

  return (
    <main style={{ padding: 16, textAlign: "center" }}>
      <canvas ref={canvasRef} width={320} height={480} style={{ border: "1px solid #ddd" }} />
      <div>Score: {score}</div>
      {/* touch buttons that set world.current.x; leaderboard from `board` */}
    </main>
  );
}
```

## Variants
- **3D** — add `"three"` + `"@react-three/fiber"` to the generated `package.json` (the
  generator injects declared deps); `<Canvas>` + `useFrame`, geometry primitives + colors
  only, **no GLTF/texture assets**. Big tap targets; same score→counter loop.
- **Clicker** — skip the rAF loop; tap a target, `world.current.score++`, timer via
  `setInterval`.
