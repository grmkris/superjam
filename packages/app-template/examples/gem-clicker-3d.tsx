// Seed jam — Golden Boot (r3f 3D clicker + cumulative counter leaderboard).
import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Stars } from "@react-three/drei";
import confetti from "canvas-confetti";
import type { Mesh } from "three";
import { sfx } from "./lib/sfx";
import { rand } from "./lib/game";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

function Ball({ onHit }: { onHit: () => void }) {
  const ref = useRef<Mesh>(null);
  const [pos, setPos] = useState<[number, number, number]>([0, 0, 0]);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 3; });
  return (
    <Float speed={3} floatIntensity={1.5}>
      <mesh ref={ref} position={pos}
        onClick={() => { sfx.pop(); onHit(); setPos([rand(-3, 3), rand(-2, 2), rand(-1.5, 0.5)]); }}>
        <icosahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color="#FFC23D" emissive="#FF4767" emissiveIntensity={0.35} metalness={0.3} roughness={0.4} />
      </mesh>
    </Float>
  );
}

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const goals = sdk.data.counter("goals");
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(20);
  const [top, setTop] = useState<{ key: string; value: number }[]>([]);
  const over = left <= 0;

  useEffect(() => {
    if (over) return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [over]);

  useEffect(() => {
    if (!over || score === 0) return;
    void (async () => {
      await goals.increment(me, score);
      const t = await goals.top(10);
      setTop(t);
      if (t[0]?.key === me) { confetti(); sfx.win(); } else { sfx.lose(); }
    })();
  }, [over]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() { setScore(0); setLeft(20); setTop([]); }

  return (
    <div className="tj-stage">
      <Canvas camera={{ position: [0, 0, 6] }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 2]} intensity={1.3} />
        <Stars radius={60} depth={40} count={800} factor={3} fade />
        {!over && <Ball onHit={() => setScore((s) => s + 1)} />}
      </Canvas>
      <div className="tj-hud">
        <div key={score} className="tj-stat tj-pop" style={{ position: "absolute", top: 14, left: 18 }}>⚽ {score}</div>
        <div className="tj-stat" style={{ position: "absolute", top: 14, right: 18 }}>⏱ {Math.max(left, 0)}</div>
        {over && (
          <div className="tj-card" style={{ position: "absolute", inset: "16% 0 auto", marginInline: "auto" }}>
            <h1 className="tj-title">Full time — {score} goals ⚽</h1>
            <ul className="tj-list">
              {top.map((e) => (
                <li key={e.key} style={e.key === me ? { color: "var(--accent)" } : undefined}>
                  <b>@{e.key}</b><span className="tj-muted" style={{ marginLeft: "auto" }}>{e.value}</span>
                </li>
              ))}
            </ul>
            <button className="tj-btn" style={{ marginTop: 12 }} onClick={reset}>Play again</button>
          </div>
        )}
      </div>
    </div>
  );
}
