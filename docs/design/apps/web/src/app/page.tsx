"use client";

import { useEffect, useRef, useState } from "react";
import { AppFrame } from "../components/app-frame";
import { IdentityBadge } from "../components/identity-badge";
import { InboxLink } from "../components/inbox-link";
import { getUsername } from "../lib/identity";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

type Question = { q: string; options: string[] };
type Spec = {
  name: string;
  slug: string;
  description: string;
  iconEmoji: string;
  features: string[];
};
type BuildRecord = {
  id: string;
  status: string;
  events: { kind: string; label: string }[];
  error?: string;
};

export default function Home() {
  const [idea, setIdea] = useState("a tip jar where people leave a message and it shows a leaderboard of top tippers");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [build, setBuild] = useState<BuildRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refine(extraAnswers?: { q: string; a: string }[]) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/api/refine`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: idea, answers: extraAnswers ?? answers }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `refine ${res.status}`);
      const data = await res.json();
      if (data.type === "questions") {
        setQuestions(data.questions);
        setSpec(null);
      } else {
        setSpec(data.spec);
        setQuestions(null);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  function answer(q: string, a: string) {
    const next = [...answers.filter((x) => x.q !== q), { q, a }];
    setAnswers(next);
    if (questions && next.length >= questions.length) void refine(next);
  }

  async function startBuild() {
    if (!spec) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/api/build`, {
        method: "POST",
        // identity rides along so the platform can stamp createdBy on the app
        headers: { "content-type": "application/json", "x-tj-user": getUsername() },
        body: JSON.stringify({ spec }),
      });
      const { buildId } = await res.json();
      setBuild({ id: buildId, status: "queued", events: [] });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  // poll build status
  const buildId = build?.id;
  const done = build?.status === "done" || build?.status === "failed";
  useEffect(() => {
    if (!buildId || done) return;
    const t = setInterval(async () => {
      const res = await fetch(`${API}/api/build/${buildId}`);
      if (res.ok) setBuild(await res.json());
    }, 1500);
    return () => clearInterval(t);
  }, [buildId, done]);

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24, display: "grid", gap: 20, gridTemplateColumns: "1fr 1fr" }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1 style={{ margin: "8px 0" }}>⚡ TurboJam</h1>
          <a href="/apps" style={{ color: "#6ee7b7", fontSize: 14 }}>view all apps →</a>
          <a href="/friends" style={{ color: "#6ee7b7", fontSize: 14 }}>friends</a>
          <InboxLink />
          <span style={{ marginLeft: "auto" }}><IdentityBadge /></span>
        </div>
        <p style={{ color: "#8b93a7", marginTop: 0 }}>
          Describe a mini app → an AI agent builds and deploys it → it runs in a sandboxed iframe.
        </p>
      </div>

      {/* Left: refine + spec */}
      <section style={card}>
        <h3 style={h3}>1 · Idea</h3>
        <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={3} style={input} />
        <button onClick={() => refine()} disabled={busy} style={btn}>
          {busy ? "thinking…" : "Refine →"}
        </button>

        {err && <p style={{ color: "#fca5a5" }}>{err}</p>}

        {questions && (
          <div style={{ marginTop: 16 }}>
            <h3 style={h3}>2 · A few questions</h3>
            {questions.map((q) => (
              <div key={q.q} style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6 }}>{q.q}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {q.options.map((o) => {
                    const sel = answers.find((a) => a.q === q.q)?.a === o;
                    return (
                      <button
                        key={o}
                        disabled={busy}
                        onClick={() => answer(q.q, o)}
                        style={{ ...chip, ...(sel ? chipSel : {}), ...(busy ? { opacity: 0.5, cursor: "wait" } : {}) }}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {busy && (
              <p style={{ color: "#6ee7b7", fontSize: 13 }}>
                <span className="tj-pulse">🤖 got it — drafting the spec… (~15s)</span>
              </p>
            )}
          </div>
        )}

        {spec && (
          <div style={{ marginTop: 16 }}>
            <h3 style={h3}>2 · Spec</h3>
            <div style={{ fontSize: 14 }}>
              <div style={{ fontSize: 22 }}>{spec.iconEmoji} <b>{spec.name}</b></div>
              <div style={{ color: "#8b93a7", margin: "4px 0 8px" }}>{spec.description}</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {spec.features.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
            <button onClick={startBuild} disabled={busy || !!build} style={{ ...btn, marginTop: 12 }}>
              {build ? "building…" : "Build it →"}
            </button>
          </div>
        )}
      </section>

      {/* Right: build feed + iframe */}
      <section style={card}>
        <h3 style={h3}>3 · Agent at work</h3>
        {!build && <p style={{ color: "#8b93a7" }}>The build feed and live app appear here.</p>}
        {build && (
          <>
            <div style={{ fontSize: 13, fontFamily: "ui-monospace, monospace", maxHeight: 160, overflow: "auto", background: "#0e1219", borderRadius: 8, padding: 10 }}>
              {build.events.map((e, i) => (
                <div key={i} style={{ color: e.kind === "error" ? "#fca5a5" : e.kind === "tool" ? "#6ee7b7" : "#cbd2e0" }}>
                  {e.kind === "tool" ? "▸" : e.kind === "error" ? "✕" : "·"} {e.label}
                </div>
              ))}
              <div style={{ color: "#8b93a7" }}>status: {build.status}</div>
            </div>
            {build.status === "done" && (
              <div style={{ marginTop: 12 }}>
                <AppFrame appId={build.id} appName={spec?.name} height={420} />
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

const card: React.CSSProperties = { background: "#161a22", borderRadius: 14, padding: 18 };
const h3: React.CSSProperties = { margin: "0 0 10px", fontSize: 14, color: "#8b93a7", textTransform: "uppercase", letterSpacing: 0.5 };
const input: React.CSSProperties = { width: "100%", background: "#0e1219", border: "1px solid #232a37", color: "#e6e9ef", borderRadius: 10, padding: 10, fontSize: 14, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" };
const btn: React.CSSProperties = { background: "#6ee7b7", color: "#04231a", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" };
const chip: React.CSSProperties = { background: "#0e1219", border: "1px solid #232a37", color: "#e6e9ef", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontSize: 13 };
const chipSel: React.CSSProperties = { background: "#6ee7b7", color: "#04231a", borderColor: "#6ee7b7" };
