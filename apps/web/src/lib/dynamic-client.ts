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
import { createDynamicClient, initializeClient } from "@dynamic-labs-sdk/client";
import { addWaasEvmExtension } from "@dynamic-labs-sdk/evm/waas";

const ENVIRONMENT_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";

function build() {
  const client = createDynamicClient({
    autoInitialize: false,
    environmentId: ENVIRONMENT_ID,
    metadata: {
      name: "SuperJam",
      universalLink:
        typeof window !== "undefined"
          ? window.location.origin
          : "https://superjam.fun",
    },
  });
  // Register the embedded-wallet (WaaS) EVM extension BEFORE initializing, then
  // kick off init (autoInitialize:false above so this ordering is deterministic).
  addWaasEvmExtension();
  void initializeClient();
  return client;
}

export const dynamicClient =
  typeof window !== "undefined" && ENVIRONMENT_ID ? build() : null;
