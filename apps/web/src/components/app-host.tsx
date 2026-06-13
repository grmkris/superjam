"use client";

// AppHost (pivot §3 seam) — the client boundary that joins the viewer's auth to
// the framed app. The viewer page (Opus P, a server component) fetches the app
// via apps.get and renders <AppHost app={app} />; this wires the signed-in
// identity (useHostAuth) into AppFrame. Falls back to a GUEST context when no
// one is signed in (the app still loads; sign-in-gated SDK calls reject).
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
  const { authToken, hostUser, getAddress } = useHostAuth();
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
