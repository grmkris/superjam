"use client";

// Host auth provider (pivot §1 login seam). Wraps the app in Dynamic's React SDK
// (@dynamic-labs/sdk-react-core) via <DynamicContextProvider> + the EVM connector.
// This is the SDK whose embedded-wallet provider + delegated access
// (useWalletDelegation) are first-class — the headless @dynamic-labs-sdk/* never
// registered the WaaS provider (NoWalletProviderFoundError). Login uses Dynamic's
// built-in auth-flow modal (setShowAuthFlow), opened by <LoginProvider>. A single
// SDK copy (clean install) ⇒ no duplicate-context crash.
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LoginProvider } from "./login";

const ENVIRONMENT_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  // Guard a build shipped without NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID (every Dynamic
  // call would otherwise crash cryptically) with a clear, actionable message.
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
    <QueryClientProvider client={queryClient}>
      <DynamicContextProvider
        settings={{
          environmentId: ENVIRONMENT_ID,
          walletConnectors: [EthereumWalletConnectors],
        }}
      >
        <LoginProvider>{children}</LoginProvider>
      </DynamicContextProvider>
    </QueryClientProvider>
  );
}
