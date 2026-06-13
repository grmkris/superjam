import type { NextConfig } from "next";

// Per-app frame-src for the viewer is set dynamically in middleware.ts. Global
// config stays minimal here.
const nextConfig: NextConfig = {
  transpilePackages: ["@superjam/sdk", "@superjam/shared", "@superjam/api"],
};

export default nextConfig;
