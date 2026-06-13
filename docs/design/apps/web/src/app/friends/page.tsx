"use client";

import { useEffect, useState } from "react";
import { getUsername } from "../../lib/identity";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

type Friend = { username: string; wallet: string };

export default function Friends() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const me = typeof window === "undefined" ? "guest" : getUsername();

  async function call(path: string, init?: RequestInit) {
    const r = await fetch(`${API}${path}`, {
      ...init,
      headers: { "x-tj-user": getUsername(), "content-type": "application/json", ...init?.headers },
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
    return data as Friend[];
  }

  useEffect(() => {
    call("/api/friends").then(setFriends).catch((e) => { setErr(String(e)); setFriends([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    if (!draft.trim()) return;
    setErr(null);
    try {
      setFriends(await call("/api/friends", { method: "POST", body: JSON.stringify({ username: draft.trim().toLowerCase() }) }));
      setDraft("");
    } catch (e) {
      setErr(String(e));
    }
  }

  async function remove(username: string) {
    setFriends(await call(`/api/friends/${username}`, { method: "DELETE" }));
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <h1 style={{ margin: "8px 0" }}>⚡ TurboJam · friends</h1>
        <a href="/" style={{ color: "#6ee7b7", fontSize: 14 }}>← build</a>
        <a href="/apps" style={{ color: "#6ee7b7", fontSize: 14 }}>apps</a>
      </div>
      <p style={{ color: "#8b93a7" }}>
        Friends you add here are visible to every mini app you play (via{" "}
        <code style={{ color: "#6ee7b7" }}>sdk.social.friends()</code>) — leaderboards, tips, invites.
        You are <b style={{ color: "#6ee7b7" }}>@{me}</b>.
      </p>

      <div style={{ background: "#161a22", borderRadius: 14, padding: 18 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="friend's username"
            style={{ flex: 1, background: "#0e1219", border: "1px solid #232a37", color: "#e6e9ef", borderRadius: 10, padding: 10, fontSize: 14 }}
          />
          <button onClick={add} style={{ background: "#6ee7b7", color: "#04231a", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>
            Add
          </button>
        </div>
        {err && <p style={{ color: "#fca5a5", fontSize: 13 }}>{err}</p>}
        {friends === null && <p style={{ color: "#8b93a7" }}>loading…</p>}
        {friends?.length === 0 && !err && <p style={{ color: "#8b93a7" }}>No friends yet — add someone by username.</p>}
        {friends?.map((f) => (
          <div key={f.username} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #232a37" }}>
            <div style={{ flex: 1 }}>
              <b>@{f.username}</b>
              <span style={{ color: "#8b93a7", fontSize: 12, marginLeft: 8 }}>{f.wallet.slice(0, 10)}…</span>
            </div>
            <button onClick={() => remove(f.username)} style={{ background: "none", border: 0, color: "#8b93a7", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>
              remove
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
