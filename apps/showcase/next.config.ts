import type { NextConfig } from "next";

// These jams are framed by the SuperJam host (pivot §3): allow that origin to
// frame us and never send X-Frame-Options. Same contract as apps/example-app.
// Self-contained app (the SDK is vendored in lib/) so it deploys standalone.
// No turbopack.root: default inference finds `next` in the repo-root node_modules
// locally (bun hoists) and in apps/showcase/node_modules on Vercel (npm install).
const FRAME_ANCESTORS =
  process.env.SUPERJAM_FRAME_ANCESTORS ??
  "https://superjam.fun https://dev.superjam.fun";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${FRAME_ANCESTORS};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
