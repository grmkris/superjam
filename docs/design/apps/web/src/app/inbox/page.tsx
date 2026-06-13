"use client";

import { useEffect, useState } from "react";
import { getUsername } from "../../lib/identity";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

type InboxMessage = {
  id: string;
  from: string;
  text: string;
  appId: string;
  appName: string;
  at: number;
  read: boolean;
};

export default function Inbox() {
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const headers = { "x-tj-user": getUsername() };
    fetch(`${API}/api/inbox`, { headers })
      .then((r) => r.json())
      .then((d: { messages: InboxMessage[] }) => {
        setMessages(d.messages);
        // viewing the inbox marks everything read
        void fetch(`${API}/api/inbox/read`, { method: "POST", headers });
      })
      .catch((e) => {
        setErr(String(e));
        setMessages([]);
      });
  }, []);

  const ago = (t: number) => {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <h1 style={{ margin: "8px 0" }}>⚡ TurboJam · inbox</h1>
        <a href="/" style={{ color: "#6ee7b7", fontSize: 14 }}>← build</a>
        <a href="/apps" style={{ color: "#6ee7b7", fontSize: 14 }}>apps</a>
        <a href="/friends" style={{ color: "#6ee7b7", fontSize: 14 }}>friends</a>
      </div>
      <p style={{ color: "#8b93a7" }}>
        Messages mini apps sent you — tips, invites, challenges. You are{" "}
        <b style={{ color: "#6ee7b7" }}>@{typeof window === "undefined" ? "" : getUsername()}</b>.
      </p>

      <div style={{ background: "#161a22", borderRadius: 14, padding: 18 }}>
        {messages === null && <p style={{ color: "#8b93a7" }}>loading…</p>}
        {err && <p style={{ color: "#fca5a5" }}>{err}</p>}
        {messages?.length === 0 && !err && (
          <p style={{ color: "#8b93a7" }}>Nothing yet — play some apps with friends.</p>
        )}
        {messages?.map((m) => (
          <div
            key={m.id}
            style={{
              padding: "10px 0",
              borderTop: "1px solid #232a37",
              opacity: m.read ? 0.75 : 1,
            }}
          >
            <div style={{ fontSize: 14 }}>
              {!m.read && <span style={{ color: "#6ee7b7", marginRight: 6 }}>●</span>}
              {m.text}
            </div>
            <div style={{ color: "#8b93a7", fontSize: 12, marginTop: 4 }}>
              from <b>@{m.from}</b> · via{" "}
              <a href={`/apps?sel=${m.appId}`} style={{ color: "#6ee7b7" }}>
                {m.appName}
              </a>{" "}
              · {ago(m.at)} ago
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
