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
