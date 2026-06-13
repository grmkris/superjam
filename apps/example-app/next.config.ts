import type { NextConfig } from "next";

// The app is framed by the SuperJam host (pivot §3). It MUST allow that origin
// to frame it and MUST NOT send X-Frame-Options (which would block framing
// outright). The host loads us in a cross-origin sandboxed iframe with
// allow-same-origin, so our own origin's cookies/storage/backend work normally.
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
