"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { IdentityBadge } from "../../components/identity-badge";
import { InboxLink } from "../../components/inbox-link";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

type AppListing = {
  id: string;
  spec: { name: string; slug: string; description: string; iconEmoji: string; features: string[] };
  durationMs?: number;
  createdAt: number;
};

export default function Apps() {
  const [apps, setApps] = useState<AppListing[] | null>(null);
  const [sel, setSel] = useState<AppListing | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/apps`)
      .then((r) => {
        if (!r.ok) throw new Error(`apps ${r.status}`);
        return r.json();
      })
      .then((a: AppListing[]) => {
        setApps(a);
        // deep link from the inbox: /apps?sel=<appId>
        const want = new URLSearchParams(window.location.search).get("sel");
        setSel(a.find((x) => x.id === want) ?? a[0] ?? null);
      })
      .catch((e) => {
        setErr(String(e));
        setApps([]);
      });
  }, []);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, display: "grid", gap: 20, gridTemplateColumns: "320px 1fr" }}>
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "baseline", gap: 14 }}>
        <h1 style={{ margin: "8px 0" }}>⚡ TurboJam · apps</h1>
        <a href="/" style={{ color: "#6ee7b7", fontSize: 14 }}>← build a new one</a>
        <a href="/friends" style={{ color: "#6ee7b7", fontSize: 14 }}>friends</a>
        <InboxLink />
        <span style={{ marginLeft: "auto" }}><IdentityBadge /></span>
      </div>

      {/* Left: app list */}
      <section style={{ ...card, maxHeight: "78vh", overflow: "auto" }}>
        {apps === null && <p style={muted}>loading…</p>}
        {err && <p style={{ color: "#fca5a5" }}>{err}</p>}
        {apps?.length === 0 && !err && <p style={muted}>No apps built yet — go make one.</p>}
        {apps?.map((a) => {
          const active = sel?.id === a.id;
          return (
            <button
              key={a.id}
              onClick={() => setSel(a)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: active ? "#1d2433" : "transparent",
                border: active ? "1px solid #6ee7b7" : "1px solid #232a37",
                color: "#e6e9ef",
                borderRadius: 10,
                padding: 12,
                marginBottom: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {a.spec.iconEmoji} {a.spec.name}
              </div>
              <div style={{ ...muted, fontSize: 13, margin: "4px 0" }}>{a.spec.description}</div>
              <div style={{ ...muted, fontSize: 12 }}>
                {new Date(a.createdAt).toLocaleString()}
                {a.durationMs ? ` · built in ${Math.round(a.durationMs / 1000)}s` : ""}
              </div>
            </button>
          );
        })}
      </section>

      {/* Right: viewer */}
      <section style={card}>
        {!sel && <p style={muted}>Select an app to run it.</p>}
        {sel && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {sel.spec.iconEmoji} {sel.spec.name}
              </div>
              <a href={`${API}/a/${sel.id}/`} target="_blank" rel="noreferrer" style={{ color: "#6ee7b7", fontSize: 13 }}>
                open full ↗
              </a>
            </div>
            <AppFrame appId={sel.id} appName={sel.spec.name} height="68vh" />
          </>
        )}
      </section>
    </main>
  );
}

const card: React.CSSProperties = { background: "#161a22", borderRadius: 14, padding: 18 };
const muted: React.CSSProperties = { color: "#8b93a7" };
