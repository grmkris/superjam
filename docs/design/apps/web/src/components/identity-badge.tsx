"use client";

import { useEffect, useState } from "react";
import { getUsername, setUsername } from "../lib/identity";

export function IdentityBadge() {
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => setName(getUsername()), []);

  if (name === null) return null;
  return (
    <span style={{ fontSize: 13, color: "#8b93a7" }}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const u = setUsername(draft);
              setName(u);
              setEditing(false);
              window.location.reload(); // re-handshake any mounted apps
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="username"
          style={{
            background: "#0e1219", border: "1px solid #232a37", color: "#e6e9ef",
            borderRadius: 8, padding: "4px 8px", fontSize: 13, width: 130,
          }}
        />
      ) : (
        <>
          playing as <b style={{ color: "#6ee7b7" }}>@{name}</b>{" "}
          <button
            onClick={() => { setDraft(name === "guest" ? "" : name); setEditing(true); }}
            style={{ background: "none", border: 0, color: "#8b93a7", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}
          >
            change
          </button>
        </>
      )}
    </span>
  );
}
