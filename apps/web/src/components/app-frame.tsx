"use client";

/* oxlint-disable react/iframe-missing-sandbox -- The iframe INTENTIONALLY sets
   allow-scripts + allow-same-origin. That combo is unsafe only for a SAME-origin
   frame; here the app is CROSS-origin (its own domain), so allow-same-origin
   grants it ITS OWN origin (never the host's) and the Same-Origin Policy + the
   postMessage bridge remain the boundary. This is the §3 pivot inversion; do NOT
   "fix" it by dropping a flag — that breaks every external app's backend session. */

// AppFrame (pivot §3) — frames an EXTERNAL, developer-hosted mini-app in a
// cross-origin sandboxed iframe and wires the host bridge to it.
//
// THE sandbox decision: `allow-same-origin` IS included and IS safe here,
// precisely because the app is served from its OWN origin (cross-origin to
// superjam.fun). The Same-Origin Policy still walls the app off from the host's
// DOM/cookies; the only channel is postMessage = the bridge. allow-same-origin
// is what lets the app use its own cookies/storage/backend session — needed for
// a real web app. (For the old platform-hosted static bundles it was correctly
// OMITTED; the pivot inverts that. See SPEC §6.)
import type { AppContext, Json } from "@superjam/sdk";
import type { Capability } from "@superjam/shared";
import { useEffect, useRef, useState } from "react";
import { createHostBridge } from "../lib/bridge/host-bridge";
import { makeHostHandlers } from "../lib/host-handlers";
import { createPlatformClient } from "../lib/orpc";

export interface ViewerApp {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
  category: string;
  entryUrl: string;
  entryOrigin: string | null;
  capabilities: Capability[];
  ensName: string | null;
}

export interface HostUser {
  id: string;
  username: string;
  walletAddress: string;
  worldVerified: boolean;
}

const parseLaunch = (): Json | null => {
  try {
    const d = new URLSearchParams(window.location.search).get("d");
    return d ? (JSON.parse(decodeURIComponent(escape(atob(d)))) as Json) : null;
  } catch {
    return null;
  }
};

export function AppFrame({
  app,
  user,
  rpcUrl,
  authToken,
}: {
  app: ViewerApp;
  user: HostUser;
  rpcUrl: string;
  authToken: string | null;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "blocked">("loading");

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const client = createPlatformClient({
      url: rpcUrl,
      getToken: () => authToken,
    });
    const bridge = createHostBridge(makeHostHandlers(client, window.location.origin));
    const detach = bridge.start();

    const ctx: AppContext = {
      appId: app.id,
      slug: app.slug,
      name: app.name,
      ensName: app.ensName,
      category: app.category,
      remixOf: null,
      launch: parseLaunch(),
      user,
    };
    const register = () => {
      const win = iframe.contentWindow;
      if (win) {
        bridge.register({
          appId: app.id,
          slug: app.slug,
          capabilities: app.capabilities,
          context: ctx,
          window: win,
        });
      }
    };
    register(); // the child posts host.hello after navigating; same Window object

    let settled = false;
    const onLoad = () => {
      settled = true;
      setPhase("ready");
      register();
    };
    iframe.addEventListener("load", onLoad);
    // Watchdog: an app that refuses to be framed (X-Frame-Options) never loads.
    const wd = setTimeout(() => {
      if (!settled) setPhase("blocked");
    }, 8000);

    return () => {
      clearTimeout(wd);
      iframe.removeEventListener("load", onLoad);
      const win = iframe.contentWindow;
      if (win) bridge.unregister(win);
      detach();
    };
  }, [app, user, rpcUrl, authToken]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {phase === "blocked" && (
        <div style={blocked}>
          <strong>{app.iconEmoji} {app.name}</strong> refused to load in SuperJam.
          <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
            The app must allow framing: send{" "}
            <code>Content-Security-Policy: frame-ancestors https://superjam.fun</code>{" "}
            and no <code>X-Frame-Options</code>.
          </div>
        </div>
      )}
      <iframe
        ref={ref}
        src={app.entryUrl}
        title={app.name}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        allow=""
        referrerPolicy="no-referrer"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
      />
    </div>
  );
}

const blocked: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
  textAlign: "center",
  padding: 24,
  background: "#fdfbf3",
  zIndex: 1,
};
