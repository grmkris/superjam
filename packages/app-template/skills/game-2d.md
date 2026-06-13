# SKILL game-2d — canvas arcade games

Deps: `<canvas>` + `./lib/game` (`useRaf`, `useKeys`, `rand`, `randInt`, `pick`,
`clamp`, `lerp`, `aabb`) + `./lib/sfx` + `canvas-confetti`. NO game engines
exist — this pattern IS the engine. Emoji are the sprite sheet (no image assets;
exception: `./assets/` files you generated per skills/art.md may be drawn with
`drawImage`).

## HARD RULES
1. ALL moving state in ONE ref object; `useRaf` mutates it and draws. setState
   only on events (score, game over) — never per frame.
2. dt is SECONDS — multiply all speeds by dt.
3. Keyboard via `useKeys` AND on-screen touch buttons (judges play on phones):
   buttons' `onPointerDown/Up` set the same `keys.current` flags.
4. Close the loop: on game over
   `sdk.data.counter("scores").increment(ctx.user.username, score)`, then render
   `counter("scores").top(10)`, own row highlighted, `confetti()` + `sfx.win()`
   on a new best.

## The pattern

```tsx
import { useRef, useState } from "react";
import { useRaf, useKeys } from "./lib/game";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const world = useRef({ px: 160, dropY: 0, score: 0, alive: true });
  const keys = useKeys();
  const [score, setScore] = useState(0);

  useRaf((dt) => {
    const c = cv.current; if (!c) return;
    const g = c.getContext("2d")!;
    const dpr = devicePixelRatio || 1;
    if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = world.current;
    if (keys.current.ArrowLeft) w.px -= 240 * dt;
    if (keys.current.ArrowRight) w.px += 240 * dt;
    w.dropY += 120 * dt;
    if (w.dropY > c.clientHeight) { w.dropY = 0; }   // (aabb-test against the basket for catches)
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    g.font = "32px serif";
    g.fillText("🧺", w.px, c.clientHeight - 12);
    g.fillText("🍎", 100, w.dropY);
  });

  const hold = (k: string, down: boolean) => () => { keys.current[k] = down; };

  return (
    <div className="tj-stage">
      <canvas ref={cv} style={{ width: "100%", height: "100%" }} />
      <div className="tj-hud">
        <div key={score} className="tj-stat tj-pop" style={{ position: "absolute", top: 12, left: 16 }}>🍎 {score}</div>
        <div className="tj-row" style={{ position: "absolute", bottom: 20, left: 0, right: 0, justifyContent: "center" }}>
          <button className="tj-btn" onPointerDown={hold("ArrowLeft", true)} onPointerUp={hold("ArrowLeft", false)} onPointerLeave={hold("ArrowLeft", false)}>◀</button>
          <button className="tj-btn" onPointerDown={hold("ArrowRight", true)} onPointerUp={hold("ArrowRight", false)} onPointerLeave={hold("ArrowRight", false)}>▶</button>
        </div>
      </div>
    </div>
  );
}
```

Collision: `aabb({x,y,w,h}, {x,y,w,h})`. Catch/dodge/jump/shoot all reduce to
arrays of boxes updated in the ref + `aabb` checks + emoji `fillText`. Sync the
displayed score with `setScore(world.current.score)` only when it changes (e.g.
in a catch branch), never every frame.

## Juice (always)
`sfx.pop()` on collect, `sfx.boom()` on collision, `sfx.win()/lose()` at round
end, `confetti()` on bests, `.tj-pop` keyed on score, `.tj-shake` on damage.
