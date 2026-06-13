"use client";

import { useEffect, useRef, useState } from "react";
import { getUsername } from "../lib/identity";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

type PendingTx = {
  to: string;
  amountUsdc: number;
  memo?: string;
  appName?: string;
  respond: (approved: boolean) => void;
};

// Host side of the mini-app bridge (SPEC §8 shape): owns the iframe, answers
// the SDK's postMessage calls by hitting the platform's /api/bridge/*, and
// renders the confirm sheet — the app never sees a wallet, only results.
export function AppFrame({
  appId,
  appName,
  height = "60vh",
}: {
  appId: string;
  appName?: string;
  height?: string | number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [tx, setTx] = useState<PendingTx | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const username = getUsername();
    const idHeaders = { "x-tj-user": username };

    async function api(path: string, body?: unknown): Promise<unknown> {
      const r = await fetch(`${API}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { ...idHeaders, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
      return data;
    }

    const onMsg = async (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return; // bind to OUR iframe only
      const m = e.data;
      if (!m || m.tj !== 1) return;

      if (m.type === "ready") {
        const me = (await api("/api/me")) as { username: string; wallet: string };
        iframe.contentWindow?.postMessage(
          { tj: 1, type: "ctx", ctx: { username: me.username, wallet: me.wallet, appId } },
          "*" // sandboxed (opaque-origin) child can't be targeted by origin
        );
        return;
      }
      if (typeof m.id !== "number" || typeof m.method !== "string") return;
      const reply = (ok: boolean, data?: unknown, error?: string) =>
        iframe.contentWindow?.postMessage({ tj: 1, id: m.id, ok, data, error }, "*");

      try {
        const p = (m.params ?? {}) as Record<string, unknown>;
        switch (m.method) {
          case "storage.get":
            reply(true, await api("/api/bridge/storage/get", { appId, key: p.key }));
            break;
          case "storage.set":
            reply(true, await api("/api/bridge/storage/set", { appId, key: p.key, value: p.value }));
            break;
          case "leaderboard.submit":
            reply(true, await api("/api/bridge/leaderboard/submit", { appId, score: p.score }));
            break;
          case "leaderboard.top":
            reply(true, await api("/api/bridge/leaderboard/top", { appId, n: p.n ?? 10 }));
            break;
          case "social.friends":
            reply(true, await api("/api/friends"));
            break;
          case "data.insert":
            reply(true, await api("/api/bridge/data/insert", { appId, collection: p.collection, doc: p.doc }));
            break;
          case "data.list":
            reply(true, await api("/api/bridge/data/list", { appId, collection: p.collection, n: p.n ?? 50 }));
            break;
          case "data.remove":
            reply(true, await api("/api/bridge/data/remove", { appId, collection: p.collection, id: p.id }));
            break;
          case "messages.send": {
            const sent = (await api("/api/bridge/messages/send", {
              appId,
              to: p.to,
              text: p.text,
              data: p.data,
            })) as { to: string };
            // transparency: the app messaged someone on the user's behalf
            showToast(`✉️ ${appName ?? "this app"} messaged @${sent.to}`);
            reply(true, sent);
            break;
          }
          case "messages.list":
            reply(true, await api("/api/bridge/messages/list", { appId, n: p.n ?? 50 }));
            break;
          case "ai.text":
            reply(true, await api("/api/bridge/ai", { appId, mode: "text", prompt: p.prompt }));
            break;
          case "ai.json":
            reply(true, await api("/api/bridge/ai", { appId, mode: "json", prompt: p.prompt, shapeHint: p.shapeHint }));
            break;
          case "ai.tools":
            reply(true, await api("/api/bridge/ai", { appId, mode: "tools", prompt: p.prompt, tools: p.tools }));
            break;
          case "ai.image":
            reply(true, await api("/api/bridge/ai/image", { appId, prompt: p.prompt }));
            break;
          case "files.upload": {
            // cheap host-side gate before shipping ~MBs to the server
            if (typeof p.dataBase64 !== "string" || p.dataBase64.length > 2.8 * 1024 * 1024) {
              reply(false, undefined, "FILE_TOO_LARGE: max 2MB");
              break;
            }
            reply(true, await api("/api/bridge/files/upload", { appId, dataBase64: p.dataBase64 }));
            break;
          }
          case "wallet.sendTransaction": {
            // capability flows through the HOST: confirm sheet, then ledger
            const approved = await new Promise<boolean>((respond) =>
              setTx({
                to: String(p.to ?? ""),
                amountUsdc: Number(p.amountUsdc ?? 0),
                memo: p.memo ? String(p.memo) : undefined,
                appName,
                respond,
              })
            );
            setTx(null);
            if (!approved) {
              reply(false, undefined, "USER_REJECTED");
              break;
            }
            reply(true, await api("/api/bridge/tx", { appId, to: p.to, amountUsdc: p.amountUsdc, memo: p.memo }));
            break;
          }
          default:
            reply(false, undefined, `UNKNOWN_METHOD ${m.method}`);
        }
      } catch (err) {
        reply(false, undefined, String(err instanceof Error ? err.message : err));
      }
    };

    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [appId, appName]);

  return (
    <div style={{ position: "relative" }}>
      {toast && (
        <div
          style={{
            position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
            background: "#161a22", border: "1px solid #2d3748", color: "#e6e9ef",
            borderRadius: 999, padding: "6px 14px", fontSize: 13, zIndex: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)", whiteSpace: "nowrap",
          }}
        >
          {toast}
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={appId}
        title={appName ?? appId}
        src={`${API}/a/${appId}/`}
        sandbox="allow-scripts allow-forms"
        style={{
          width: "100%",
          height,
          border: "1px solid #232a37",
          borderRadius: 10,
          background: "#0b0d12",
          display: "block",
        }}
      />
      {tx && (
        <div
          style={{
            position: "absolute", inset: 0, background: "rgba(4,6,10,0.72)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            borderRadius: 10, zIndex: 5,
          }}
        >
          <div
            style={{
              background: "#161a22", border: "1px solid #232a37", borderRadius: "14px 14px 10px 10px",
              padding: 20, width: "100%", maxWidth: 420, margin: 10,
            }}
          >
            <div style={{ fontSize: 13, color: "#8b93a7", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Confirm payment
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, margin: "10px 0 2px" }}>
              Send {tx.amountUsdc} USDC
            </div>
            <div style={{ color: "#8b93a7", fontSize: 13, wordBreak: "break-all" }}>
              to {tx.to}
              {tx.memo ? <> · “{tx.memo}”</> : null}
            </div>
            <div style={{ color: "#8b93a7", fontSize: 12, marginTop: 6 }}>
              requested by {tx.appName ?? "this mini app"} — mock ledger, no real funds
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                onClick={() => tx.respond(true)}
                style={{ flex: 1, background: "#6ee7b7", color: "#04231a", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}
              >
                Approve
              </button>
              <button
                onClick={() => tx.respond(false)}
                style={{ flex: 1, background: "#0e1219", color: "#e6e9ef", border: "1px solid #232a37", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
