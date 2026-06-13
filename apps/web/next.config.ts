import type { NextConfig } from "next";

// Per-app frame-src for the viewer is set dynamically in middleware.ts. Global
// config stays minimal here.
const nextConfig: NextConfig = {
  transpilePackages: ["@superjam/sdk", "@superjam/shared", "@superjam/api"],
  // @worldcoin/idkit v4 runs its connect/proof logic in WebAssembly
  // (idkit-core ships idkit_wasm_bg.wasm, loaded via `new URL(..., import.meta.url)`
  // + WebAssembly.instantiate). Without this webpack never emits/serves the .wasm,
  // so the widget silently no-ops on open. Enable async WASM + give the module a
  // stable served path (client vs server output dirs differ).
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.output.webassemblyModuleFilename = isServer
      ? "../static/wasm/[modulehash].wasm"
      : "static/wasm/[modulehash].wasm";
    return config;
  },
};

export default nextConfig;
