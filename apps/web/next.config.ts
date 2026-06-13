import type { NextConfig } from "next";

// Per-app frame-src for the viewer is set dynamically in middleware.ts. Global
// config stays minimal here.
const nextConfig: NextConfig = {
  transpilePackages: ["@superjam/sdk", "@superjam/shared", "@superjam/api"],
  // @worldcoin/idkit v4 runs on WASM (idkit-core's idkit_wasm_bg.wasm, loaded via
  // `new URL(..., import.meta.url)`). Turbopack (the Next 16 default) serves that
  // pattern natively — no config needed; the widget is kept client-only via
  // next/dynamic({ssr:false}) in world-gate.tsx so the WASM never instantiates
  // during SSR. (That dynamic import — not the bundler — was the real fix.)
};

export default nextConfig;
