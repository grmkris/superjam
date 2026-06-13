"use client";

// The mini-app UI. Demonstrates the full external-app contract (pivot):
//  1. connect to the SuperJam host via @superjam/sdk (standalone-safe in dev)
//  2. get a platform identity token (sdk.auth.getToken) and call THIS app's
//     OWN backend with it — the backend verifies it against SuperJam's JWKS
//  3. read/write the app's OWN database (Neon) keyed by the verified user
//  4. use a platform-only capability (payments) through the SDK
import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

interface Entry {
  id: number;
  username: string;
  worldVerified: boolean;
  message: string;
  createdAt: string;
}
interface Me {
  userId: string;
  username: string;
  worldVerified: boolean;
}

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasDb, setHasDb] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("connecting…");

  // Authenticated fetch: attach a fresh SuperJam identity token (the app's
  // backend verifies it). Re-fetch on every call — tokens are short-lived.
  const authFetch = async (path: string, init?: RequestInit) => {
    const sdk = sdkRef.current!;
    const { token } = await sdk.auth.getToken();
    return fetch(path, {
      ...init,
      headers: {
        ...init?.headers,
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    });
  };

  const loadEntries = async () => {
    const res = await fetch("/api/entries");
    const json = await res.json();
    setEntries(json.entries ?? []);
    setHasDb(Boolean(json.hasDatabase));
  };

  useEffect(() => {
    (async () => {
      const sdk = await SuperJam.connect();
      sdkRef.current = sdk;
      setStandalone(sdk.standalone);
      await loadEntries();
      if (sdk.standalone) {
        setStatus("standalone — open inside SuperJam to sign in");
        return;
      }
      try {
        const res = await authFetch("/api/me");
        if (res.ok) {
          setMe((await res.json()).user);
          setStatus("");
        } else {
          setStatus(`identity check failed (${res.status})`);
        }
      } catch (e) {
        setStatus(`identity error: ${String(e)}`);
      }
    })();
  }, []);

  const post = async () => {
    if (!message.trim() || !sdkRef.current) return;
    const res = await authFetch("/api/entries", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (res.ok) {
      setMessage("");
      await loadEntries();
    } else {
      setStatus(`post failed (${res.status})`);
    }
  };

  const tip = async () => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    try {
      await sdk.payments.payUSDC({ amount: "0.50" });
      sdk.ui.toast("Thanks for the tip! 💸");
    } catch (e) {
      setStatus(`tip cancelled: ${String(e)}`);
    }
  };

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>📖 Guestbook</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        A developer-hosted SuperJam mini-app — Next.js + its own database.{" "}
        {hasDb ? "Neon-backed." : "(in-memory — set DATABASE_URL for Neon)"}
      </p>

      {standalone && (
        <div style={banner}>
          You're viewing this standalone. Open it inside SuperJam to sign in and
          post as yourself.
        </div>
      )}
      {me && (
        <p style={{ fontSize: 14 }}>
          Signed in as <strong>@{me.username}</strong>
          {me.worldVerified ? " ✅ (World-verified)" : ""} — verified by your own
          backend against SuperJam's JWKS.
        </p>
      )}
      {status && <p style={{ color: "#a00", fontSize: 13 }}>{status}</p>}

      {!standalone && (
        <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Leave a message…"
            maxLength={280}
            style={input}
          />
          <button onClick={post} style={btn}>
            Post
          </button>
          <button onClick={tip} style={{ ...btn, background: "#ffd23f" }}>
            Tip 50¢
          </button>
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {entries.map((e) => (
          <li key={e.id} style={card}>
            <strong>@{e.username}</strong>
            {e.worldVerified ? " ✅" : ""}
            <div>{e.message}</div>
          </li>
        ))}
        {entries.length === 0 && <p style={{ color: "#999" }}>No entries yet.</p>}
      </ul>
    </main>
  );
}

const banner: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #ffe69c",
  borderRadius: 8,
  padding: 12,
  fontSize: 14,
  margin: "12px 0",
};
const input: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #ddd",
};
const btn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #1a1a1a",
  background: "#fff",
  cursor: "pointer",
};
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 12,
  marginBottom: 8,
};
