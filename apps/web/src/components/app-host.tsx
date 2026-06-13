"use client";

// AppHost (pivot §3 seam) — the client boundary that joins the viewer's auth to
// the framed app. The viewer page (Opus P, a server component) fetches the app
// via apps.get and renders <AppHost app={app} />; this wires the signed-in
// identity (useHostAuth) into AppFrame. Falls back to a GUEST context when no
// one is signed in (the app still loads; sign-in-gated SDK calls reject).
//
// CRITICAL — wait for `meStatus === "ready"` before framing the app. The child's
// SDK does a ONE-TIME `host.hello`/`app.context` handshake and caches the result;
// if we mount while `profile.me` is still in flight, it handshakes against GUEST
// (worldVerified:false) and a verified user looks unverified forever (e.g. Final
// Pot's `ctx.user.worldVerified` gate never opens). For a logged-out viewer
// `meStatus` is `"ready"` immediately, so GUEST is then authoritative and there's
// no extra wait. (`"error"` also unblocks — GUEST is the honest fallback there.)
import { browserRpcUrl } from "../lib/orpc";
import { useHostAuth } from "../lib/use-host-auth";
import { AppFrame, type HostUser, type ViewerApp } from "./app-frame";

const GUEST: HostUser = {
  id: "guest",
  username: "guest",
  walletAddress: "0x0000000000000000000000000000000000000000",
  worldVerified: false,
};

export function AppHost({ app }: { app: ViewerApp }) {
  const { authToken, hostUser, getAddress, meStatus } = useHostAuth();

  // Don't hand the app a context until the viewer's identity is authoritative.
  if (meStatus === "pending") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#999",
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <AppFrame
      app={app}
      user={hostUser ?? GUEST}
      rpcUrl={browserRpcUrl()}
      authToken={authToken}
      getAddress={getAddress}
    />
  );
}
