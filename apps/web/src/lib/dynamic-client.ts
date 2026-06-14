"use client";

// The single Dynamic client instance (new headless SDK @dynamic-labs-sdk/*).
//
// WHY a singleton module: the old React-context SDK (@dynamic-labs/sdk-react-core)
// duplicated under Turbopack (two physical copies of sdk-react-core → two
// ViewContextProviders → "No Dynamic client" crash). The new SDK is a single
// imperative client shared via <DynamicProvider client={…}> — no React-context
// duplication is possible, so Turbopack runs it cleanly.
//
// Created CLIENT-SIDE only: <Providers> lives under ClientRoot's mounted gate, so
// this module is only evaluated into a real client in the browser (null on the
// server pass, where <Providers> renders the env-guard screen instead).
import { createDynamicClient } from "@dynamic-labs-sdk/client";
import { addEvmExtension } from "@dynamic-labs-sdk/evm";

const ENVIRONMENT_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";

function build() {
  // Match Dynamic's working headless example (dynamic-labs-oss/examples →
  // nextjs-js-sdk-wallet-demo): autoInitialize:true, then addEvmExtension (NOT the
  // narrower addWaasEvmExtension — addEvmExtension is the superset that wires
  // EIP-6963 + the WaaS embedded-wallet provider together, which is what makes
  // createWalletClientForWalletAccount + delegateWaasKeyShares resolve the provider).
  // No manual initializeClient() — autoInitialize sequences it so the provider
  // survives. (addWaasEvmExtension alone left the WaaS provider unregistered →
  // NoWalletProviderFoundError on every sign/delegate.)
  const client = createDynamicClient({
    autoInitialize: true,
    environmentId: ENVIRONMENT_ID,
    metadata: {
      name: "SuperJam",
      universalLink:
        typeof window !== "undefined"
          ? window.location.origin
          : "https://superjam.fun",
    },
  });
  addEvmExtension(client);
  return client;
}

export const dynamicClient =
  typeof window !== "undefined" && ENVIRONMENT_ID ? build() : null;
