import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pin the Turbopack root to THIS app's dir so it doesn't walk up to the
// monorepo's bun.lock and mis-infer the workspace root (which breaks `vercel
// build`). The app is self-contained (SDK vendored in lib/).
const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));

// These jams are framed by the SuperJam host (pivot §3): allow that origin to
// frame us and never send X-Frame-Options. Same contract as apps/example-app.
// Self-contained app (the SDK is vendored in lib/) so it deploys standalone.
const FRAME_ANCESTORS =
  process.env.SUPERJAM_FRAME_ANCESTORS ??
  "https://superjam.fun https://dev.superjam.fun";

const nextConfig: NextConfig = {
  turbopack: { root: APP_ROOT },
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
