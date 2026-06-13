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
