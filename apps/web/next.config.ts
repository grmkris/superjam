import type { NextConfig } from "next";

// Per-app frame-src for the viewer is set dynamically in middleware.ts.
// (Bundler = webpack via the apps/web scripts; see the note below.)
//
// BUNDLER: built with webpack (apps/web `dev`/`build` use `--webpack`), NOT the
// Next 16 default Turbopack. Reason: the @dynamic-labs wallet SDK duplicates its
// shared store singleton under Turbopack — DynamicContextProvider writes the
// client into one instance while the hooks read another → "No Dynamic client has
// been created yet" / "Hook must be used within <ViewContextProvider>" (login
// crash). webpack dedupes it; transpilePackages did NOT fix it under Turbopack.
// (Turbopack serves idkit's WASM fine, but the Dynamic SDK isn't Turbopack-ready.)
const nextConfig: NextConfig = {
  transpilePackages: ["@superjam/sdk", "@superjam/shared", "@superjam/api"],
  // Run "Collecting page data" single-threaded. Our custom `webpack` config below
  // is a function (non-cloneable), and Next's page-data worker threads try to
  // structured-clone next.config to each worker → DataCloneError → the build wedges
  // forever at "Collecting page data" (vercel/next.js#69096). Single-threaded page
  // collection has nothing to clone. (7 client-shell pages → trivially fast anyway.)
  experimental: { workerThreads: false, cpus: 1 },
  // @worldcoin/idkit v4 runs on WASM (idkit-core's idkit_wasm_bg.wasm, loaded via
  // `new URL(..., import.meta.url)`). asyncWebAssembly emits/serves it under webpack;
  // the widget is loaded client-only via next/dynamic({ssr:false}) in world-gate.tsx.
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.output.webassemblyModuleFilename = isServer
      ? "../static/wasm/[modulehash].wasm"
      : "static/wasm/[modulehash].wasm";
    return config;
  },
};

export default nextConfig;
