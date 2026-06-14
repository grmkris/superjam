"use client";

// Judges' Whimsy (ETHGlobal NY edition) — a 3D comedy stage where a panel of
// parody crypto judges roast your hackathon pitch. Real Gemini does the roasting
// (works live in DEMO_MODE); the 3D scene + leaderboard are local/collection
// state. No onchain. Same AI-json + collection/counter pattern as /roast, with a
// r3f stage modelled on packages/app-template/examples/gem-clicker-3d.tsx.
import type { Doc, Json, SuperJamSdk } from "../../lib/superjam-sdk";
import { Float, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import confetti from "canvas-confetti";
import { useEffect, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { JamPage } from "../../lib/jam";

// Fixed persona display; the AI returns 3 scores+quips in this order.
const JUDGES = [
  { name: "The Maxi", emoji: "🗽", color: "#4D7CFF", blurb: "decentralize or perish" },
  { name: "The VC", emoji: "💸", color: "#2FD180", blurb: "what's the TAM, ser?" },
  { name: "The Degen", emoji: "🥯", color: "#FFC940", blurb: "gm. wen token" },
] as const;

const SAMPLES = [
  "Uber for pigeons, but onchain",
  "an AI agent that mints my breakfast 🍳",
  "ZK-proof that I actually went to the gym",
  "Tinder, but you swipe on smart contracts",
  "a DAO that decides what I eat for lunch",
];

const asObj = (v: Json | null): Record<string, Json> =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

interface JudgeScore { score: number; quip: string }
interface Verdict { title: string; overall: number; judges: JudgeScore[] }

// ── 3D stage: a rotating ETH diamond over a low-poly NYC skyline + 3 bobbing
//    judge gems that puff up when the verdict is happy. ───────────────────────
function EthDiamond({ cheer }: { cheer: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * (cheer ? 2.4 : 0.8);
  });
  return (
    <Float speed={2} floatIntensity={1.2}>
      <mesh ref={ref} position={[0, 0.6, 0]}>
        <octahedronGeometry args={[1.05, 0]} />
        <meshStandardMaterial color="#8FA2FF" emissive="#4D7CFF" emissiveIntensity={cheer ? 0.7 : 0.3} metalness={0.6} roughness={0.25} flatShading />
      </mesh>
    </Float>
  );
}

function JudgeGem({ x, color, lift }: { x: number; color: string; lift: number }) {
  const ref = useRef<Group>(null);
  useFrame((s) => {
    if (ref.current) ref.current.position.y = -1.1 + lift + Math.sin(s.clock.elapsedTime * 2 + x) * 0.08;
  });
  return (
    <group ref={ref} position={[x, -1.1, 1.4]}>
      <Float speed={3} rotationIntensity={0.4} floatIntensity={0.4}>
        <mesh>
          <icosahedronGeometry args={[0.42, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} flatShading />
        </mesh>
      </Float>
    </group>
  );
}

function Skyline() {
  const bars = [
    [-2.6, 1.1], [-1.9, 1.8], [-1.2, 1.3], [-0.5, 2.2],
    [0.3, 1.5], [1.0, 2.0], [1.7, 1.2], [2.4, 1.7],
  ];
  return (
    <group position={[0, -2.4, -1.5]}>
      {bars.map(([x, h], i) => (
        <mesh key={i} position={[x!, h! / 2, 0]}>
          <boxGeometry args={[0.5, h!, 0.5]} />
          <meshStandardMaterial color="#2A2540" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function Stage({ verdict }: { verdict: Verdict | null }) {
  const cheer = (verdict?.overall ?? 0) >= 8;
  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 50 }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 2]} intensity={1.3} />
      <Stars radius={50} depth={30} count={500} factor={3} fade speed={1} />
      <EthDiamond cheer={cheer} />
      <Skyline />
      {JUDGES.map((j, i) => (
        <JudgeGem key={j.name} x={(i - 1) * 1.5} color={j.color} lift={(verdict?.judges[i]?.score ?? 0) / 14} />
      ))}
    </Canvas>
  );
}

function WhimsyApp({ sdk }: { sdk: SuperJamSdk }) {
  const verdicts = sdk.data.collection("verdicts");
  const claps = sdk.data.counter("claps");
  const [pitch, setPitch] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [feed, setFeed] = useState<Doc[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});

  async function refresh() {
    const [{ docs }, top] = await Promise.all([verdicts.list({ limit: 40 }), claps.top(200)]);
    const map: Record<string, number> = {};
    for (const t of top) map[t.key] = t.value;
    setScores(map);
    docs.sort((a, b) => (map[b.id] ?? 0) - (map[a.id] ?? 0));
    setFeed(docs);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, []);

  async function faceJudges() {
    if (!pitch.trim() || busy) return;
    setBusy(true);
    setVerdict(null);
    try {
      const { text } = await sdk.ai.chat(
        [
          {
            role: "system",
            content:
              "You are a panel of three over-the-top judges at an ETHGlobal New York hackathon: " +
              "(1) The Maxi 🗽 — only cares about decentralization, roasts anything centralized; " +
              "(2) The VC 💸 — a NY finance bro obsessed with TAM, moat and exits; " +
              "(3) The Degen 🥯 — gm-ser energy with NY bagel/pizza and gas-fee puns. " +
              "Given a hackathon pitch, reply ONLY as JSON: " +
              "{\"title\": a 2-4 word satirical award, \"judges\":[{\"score\": int 1-10, \"quip\": one short funny line}, {…}, {…}]} " +
              "— exactly 3 judges in that order (Maxi, VC, Degen). Keep quips punchy and PG-13.",
          },
          { role: "user", content: `Pitch: ${pitch.trim()}` },
        ],
        { json: true }
      );
      const v = parseVerdict(text);
      setVerdict(v);
      if (v.overall >= 8) confetti({ particleCount: 120, spread: 75, origin: { y: 0.4 } });
      const { id } = await verdicts.insert({ pitch: pitch.trim(), title: v.title, overall: v.overall, judges: v.judges as unknown as Json });
      await claps.increment(id, 0);
      await refresh();
    } catch {
      sdk.ui.toast("the judges are at the open bar — try again");
    } finally {
      setBusy(false);
    }
  }

  async function clap(id: string) {
    setScores((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }));
    await claps.increment(id, 1);
  }

  return (
    <div className="sj-wrap">
      <div className="tj-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ height: 240, background: "linear-gradient(#1a1430,#322a52)" }}>
          <Stage verdict={verdict} />
        </div>
        <div style={{ padding: 20 }}>
          <h1 className="tj-title">🏆 Judges&apos; Whimsy</h1>
          <p className="tj-sub">Pitch your idea. Face the ETHGlobal NY judges. Survive.</p>
          <div className="tj-row" style={{ flexWrap: "wrap", marginBottom: 10 }}>
            {SAMPLES.map((s) => (
              <button key={s} className="tj-pill" onClick={() => setPitch(s)}>{s}</button>
            ))}
          </div>
          <textarea
            className="tj-input"
            rows={2}
            style={{ resize: "none" }}
            placeholder="e.g. a ZK rollup… for my laundry"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
          />
          <button className="tj-btn" style={{ width: "100%", marginTop: 10 }} onClick={faceJudges} disabled={busy || !pitch.trim()}>
            {busy ? "the judges confer… 👀" : "Face the judges 🗽"}
          </button>
        </div>
      </div>

      {verdict && (
        <div className="tj-card tj-pop">
          <div className="tj-center" style={{ marginBottom: 12 }}>
            <span className="tj-badge">🏅 {verdict.title}</span>
            <div className="tj-stat" style={{ fontSize: 32 }}>{verdict.overall}/10</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {JUDGES.map((j, i) => {
              const js = verdict.judges[i];
              return (
                <div key={j.name} className="tj-card" style={{ background: "var(--bg)", padding: 12, borderLeft: `6px solid ${j.color}` }}>
                  <div className="tj-row" style={{ justifyContent: "space-between" }}>
                    <b>{j.emoji} {j.name}</b>
                    <span style={{ fontWeight: 800, color: j.color }}>{js?.score ?? "?"}/10</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{js?.quip ?? ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>👏 Hall of Whimsy</h2>
        <p className="tj-sub">The pitches that survived. Clap for your favourites.</p>
        <ul className="tj-list">
          {feed.map((d) => {
            const data = asObj(d.data);
            return (
              <li key={d.id} style={{ alignItems: "flex-start", gap: 10 }}>
                <button className="tj-pill" onClick={() => clap(d.id)}>👏 {scores[d.id] ?? 0}</button>
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{String(data.title ?? "Pitch")}</b>{" "}
                  <span className="tj-muted" style={{ fontSize: 12 }}>· {String(data.overall ?? "?")}/10 · @{d.username}</span>
                  <div style={{ fontSize: 13 }}>{String(data.pitch ?? "")}</div>
                </span>
              </li>
            );
          })}
          {feed.length === 0 && <div className="tj-empty">No survivors yet — pitch something 🗽</div>}
        </ul>
      </div>
    </div>
  );
}

function parseVerdict(text: string): Verdict {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const judges = Array.isArray(j.judges) ? j.judges : [];
    const norm: JudgeScore[] = JUDGES.map((_, i) => {
      const x = asObj((judges[i] ?? null) as Json);
      return {
        score: Math.max(1, Math.min(10, Number(x.score) || 5)),
        quip: String(x.quip ?? "…speechless."),
      };
    });
    const overall = Math.round(norm.reduce((a, b) => a + b.score, 0) / norm.length);
    return { title: String(j.title ?? "Participation Trophy"), overall, judges: norm };
  } catch {
    return {
      title: "Off-Chain Energy",
      overall: 5,
      judges: JUDGES.map(() => ({ score: 5, quip: "the judges were too busy at the open bar." })),
    };
  }
}

export default function Page() {
  return <JamPage render={(sdk) => <WhimsyApp sdk={sdk} />} />;
}
