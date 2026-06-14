import type { NextConfig } from "next";

// Per-app frame-src for the viewer is set dynamically in middleware.ts.
//
// BUNDLER: webpack (`--webpack` in dev/build), NOT Turbopack. The @dynamic-labs
// React SDK (sdk-react-core) crashes under Turbopack — it sits on the headless
// @dynamic-labs-sdk/client, and Turbopack duplicates its module graph → two client
// singletons → "No Dynamic client" / "Hook must be used within <ViewContextProvider>".
// Dynamic's own Next examples run on webpack (Next 15), never Turbopack. The
// externals below mirror Dynamic's example next.config: pino-pretty/lokijs/encoding
// are Node-only deps the SDK drags in that must NOT be bundled for the browser.
// idkit v4's WASM (`new URL('idkit_wasm_bg.wasm', import.meta.url)`) is served by
// webpack 5's native asset handling; the widget stays client-only via
// next/dynamic({ssr:false}) in world-gate.tsx.
const nextConfig: NextConfig = {
  transpilePackages: ["@superjam/sdk", "@superjam/shared", "@superjam/api"],
  // Cap build workers. Railway's Metal builder reports ~14 CPUs, so Next spawns 14
  // page-data/static-gen workers; each loads the heavy Dynamic SDK bundle and they
  // thrash the build container's RAM → "Collecting page data" hangs. 4 (≈ local)
  // keeps memory in check. (Next floors this at 4.)
  experimental: { cpus: 4 },
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
