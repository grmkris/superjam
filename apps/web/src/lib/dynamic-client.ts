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
import { addWaasEvmExtension } from "@dynamic-labs-sdk/evm/waas";

const ENVIRONMENT_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";

function build() {
  // Match Dynamic's working headless example (dynamic-labs-oss/examples →
  // nextjs-js-sdk-wallet-demo): autoInitialize:true + register the extension, and
  // do NOT call initializeClient() manually. Our previous `autoInitialize:false`
  // + a manual initializeClient() AFTER the extension rebuilt the wallet-provider
  // registry and dropped the WaaS provider — so createWalletClientForWalletAccount
  // and delegateWaasKeyShares both threw NoWalletProviderFoundError. autoInitialize
  // sequences init so the extension's provider survives.
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
  addWaasEvmExtension(client);
  return client;
}

export const dynamicClient =
  typeof window !== "undefined" && ENVIRONMENT_ID ? build() : null;
