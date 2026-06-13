"use client";

import { useEffect, useState } from "react";
import { getUsername } from "../lib/identity";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

export function InboxLink() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    fetch(`${API}/api/inbox`, { headers: { "x-tj-user": getUsername() } })
      .then((r) => r.json())
      .then((d: { unread?: number }) => setUnread(d.unread ?? 0))
      .catch(() => {});
  }, []);

  return (
    <a href="/inbox" style={{ color: "#6ee7b7", fontSize: 14 }}>
      inbox
      {unread > 0 && (
        <span
          style={{
            background: "#6ee7b7", color: "#04231a", borderRadius: 999,
            padding: "1px 7px", fontSize: 11, fontWeight: 700, marginLeft: 5,
          }}
        >
          {unread}
        </span>
      )}
    </a>
  );
}
