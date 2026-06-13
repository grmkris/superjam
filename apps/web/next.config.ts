import type { NextConfig } from "next";

// Per-app frame-src for the viewer is set dynamically in middleware.ts. Global
// config stays minimal here.
const nextConfig: NextConfig = {
  transpilePackages: [
    "@superjam/sdk",
    "@superjam/shared",
    "@superjam/api",
    // @dynamic-labs/* — force Turbopack to treat the SDK as a SINGLE instance.
    // Without this, Turbopack duplicates @dynamic-labs/store (the shared client
    // singleton): DynamicContextProvider writes the client into one copy while the
    // hooks read another → "No Dynamic client has been created yet" +
    // "Hook must be used within <ViewContextProvider>" (login crash). webpack
    // deduped it; Turbopack needs this explicit list.
    "@dynamic-labs/sdk-react-core",
    "@dynamic-labs/ethereum",
    "@dynamic-labs/ethereum-core",
    "@dynamic-labs/store",
    "@dynamic-labs/utils",
    "@dynamic-labs/sdk-api-core",
    "@dynamic-labs/types",
    "@dynamic-labs/wallet-connector-core",
    "@dynamic-labs/logger",
    "@dynamic-labs/multi-wallet",
    "@dynamic-labs/rpc-providers",
    "@dynamic-labs/embedded-wallet",
    "@dynamic-labs/embedded-wallet-evm",
    "@dynamic-labs/wallet-book",
    "@dynamic-labs/iconic",
    "@dynamic-labs/locale",
    "@dynamic-labs/message-transport",
    "@dynamic-labs/assert-package-version",
    "@dynamic-labs/waas",
    "@dynamic-labs/waas-evm",
    "@dynamic-labs/webauthn",
  ],
  // @worldcoin/idkit v4 runs on WASM (idkit-core's idkit_wasm_bg.wasm, loaded via
  // `new URL(..., import.meta.url)`). Turbopack (the Next 16 default) serves that
  // pattern natively — no config needed; the widget is kept client-only via
  // next/dynamic({ssr:false}) in world-gate.tsx so the WASM never instantiates
  // during SSR. (That dynamic import — not the bundler — was the real fix.)
};

export default nextConfig;
