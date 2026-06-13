"use client";

// Host auth provider (pivot §1 login seam). Wraps the app in Dynamic so the
// viewer can sign the user in and mint platform identity tokens for the framed
// mini-apps. Opus P's product routes (login UI, /me) consume useHostAuth; this
// provider is the seam (mine). The integrator's confirm-popup is toggled OFF in
// the Dynamic dashboard so our own confirm sheet is the only UI (§6).
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import type { ReactNode } from "react";

const ENVIRONMENT_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  // NEXT_PUBLIC_* is baked at build time. If the web image was built without the
  // Dynamic env id, DynamicContextProvider can't create a client and every
  // Dynamic hook crashes cryptically (ClientNotFoundError / ViewContextProvider).
  // Fail with a clear, actionable message instead of white-screening the app.
  if (!ENVIRONMENT_ID) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40 }}>🔧</div>
          <h1 style={{ fontSize: 18, margin: "8px 0" }}>Auth not configured</h1>
          <p style={{ color: "#666", fontSize: 14 }}>
            This build was created without{" "}
            <code>NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID</code>. Set it as a web
            build arg and redeploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId: ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}
