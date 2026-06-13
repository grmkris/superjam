import type { NextConfig } from "next";

// Per-app frame-src for the viewer is set dynamically in middleware.ts.
//
// BUNDLER: Turbopack (the Next 16 default — no --webpack). The @dynamic-labs SDK
// used to crash under Turbopack ("No Dynamic client" / "Hook must be used within
// <ViewContextProvider>") because a STALE lockfile left two physical copies of
// @dynamic-labs/store (4.88.5 + 4.88.6) → two store singletons. A clean reinstall
// (rm node_modules bun.lock) deduped the whole @dynamic-labs family to one version,
// so Turbopack now runs it like Dynamic's own Next examples. No webpack() override
// needed: Turbopack serves idkit v4's WASM (`new URL('idkit_wasm_bg.wasm',
// import.meta.url)`) natively; the widget is client-only via next/dynamic({ssr:false})
// in world-gate.tsx.
const nextConfig: NextConfig = {
  transpilePackages: ["@superjam/sdk", "@superjam/shared", "@superjam/api"],
};

export default nextConfig;
