# SKILL game-3d — 3D scenes & games with React Three Fiber

Deps (installed, import directly): `@react-three/fiber` (`<Canvas>`,
`useFrame`), `@react-three/drei` — ONLY `Float`, `Stars`, `OrbitControls`,
`Center`, `RoundedBox`, `Html` —, `three` (types/math), `canvas-confetti`,
`./lib/sfx`, `./lib/game`.

## HARD RULES
1. **No external assets**: no GLTF models, no fonts, no texture URLs. Build from
   geometry primitives + `color`/`emissive` materials. From drei NEVER use
   `Text`/`Text3D`/`Environment`/`useTexture`/`useGLTF` (network loads —
   blocked). Exception: files YOU generated into `./assets/` with the
   generate_image tool (skills/art.md) may be used, e.g.
   `useTexture("./assets/floor.webp")`.
2. **Per-frame state in refs**: inside `useFrame` mutate `ref.current`; call
   setState only on events (hit, score, game over).
3. **Instantly playable**, big tap targets (phones). Labels = drei `<Html>` or a
   `.tj-hud` DOM overlay — never 3D text.
4. **Close the loop**: live score → on game over
   `sdk.data.counter("scores").increment(ctx.user.username, score)` → render
   `counter("scores").top(10)` with the own row highlighted → new personal best
   ⇒ `confetti()` + `sfx.win()`. (A counter is cumulative — this gives an
   all-time leaderboard; for a strict high-score board keep the best in
   `sdk.storage` and increment by `newBest - oldBest`.)
5. < 100 meshes; low-poly `args`.

## The pattern (full-bleed stage, lights, click targets — r3f raycasts for you)

```tsx
import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Stars } from "@react-three/drei";
import confetti from "canvas-confetti";
import type { Mesh } from "three";
import { sfx } from "./lib/sfx";
import { rand } from "./lib/game";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

function Gem({ onHit }: { onHit: () => void }) {
  const ref = useRef<Mesh>(null);
  const [pos, setPos] = useState<[number, number, number]>([0, 0, 0]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 2;   // refs, not setState
  });
  return (
    <Float speed={2}>
      <mesh ref={ref} position={pos}
        onClick={() => { sfx.pop(); onHit(); setPos([rand(-3, 3), rand(-2, 2), rand(-2, 0)]); }}>
        <icosahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color="#FF4D6D" emissive="#2FD180" emissiveIntensity={0.4} />
      </mesh>
    </Float>
  );
}

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(20);
  const [top, setTop] = useState<{ key: string; value: number }[]>([]);
  const over = left <= 0;
  const scores = sdk.data.counter("scores");

  useEffect(() => {
    if (over) return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [over]);

  useEffect(() => {
    if (!over) return;
    void (async () => {
      await scores.increment(me, score);
      const t = await scores.top(10);
      setTop(t);
      if (t[0]?.key === me) { confetti(); sfx.win(); }
    })();
  }, [over]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tj-stage">
      <Canvas camera={{ position: [0, 0, 6] }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.2} />
        <Stars />
        {!over && <Gem onHit={() => setScore((s) => s + 1)} />}
      </Canvas>
      <div className="tj-hud">
        <div key={score} className="tj-stat tj-pop" style={{ position: "absolute", top: 12, left: 16 }}>💎 {score}</div>
        <div className="tj-stat" style={{ position: "absolute", top: 12, right: 16 }}>⏱ {Math.max(left, 0)}</div>
        {over && (
          <div className="tj-card" style={{ position: "absolute", inset: "18% 8% auto" }}>
            <h1 className="tj-title">Game over — {score} 💎</h1>
            <ul className="tj-list">
              {top.map((e) => (
                <li key={e.key} style={e.key === me ? { color: "var(--accent)" } : undefined}>
                  <b>@{e.key}</b> <span className="tj-muted" style={{ marginLeft: "auto" }}>{e.value}</span>
                </li>
              ))}
            </ul>
            <button className="tj-btn" onClick={() => { setScore(0); setLeft(20); }}>Play again</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

Movement without physics: `lerp` toward targets in `useFrame`, or integrate
velocity manually (`pos += vel * dt`). Camera shake: nudge
`state.camera.position` briefly in `useFrame`.

## Juice (always)
`sfx.pop()` on hits, `sfx.win()/lose()` on round end, `confetti()` on bests,
`<div key={score} className="tj-stat tj-pop">` to pop the score, `.tj-shake` on
the stage when taking damage.
