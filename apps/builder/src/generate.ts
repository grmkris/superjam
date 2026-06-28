// Template generator (pivot §6 "(a) Generate"). Produces a deployable Next.js
// 16 app dir from an AppSpec as a file map. This is the DETERMINISTIC bootstrap
// fill — a valid skeleton (framed-by-superjam headers, optional Neon+Drizzle
// data layer, JWKS verify) that the agent-enhanced fill and Opus B's richer
// Next+SDK template supersede. The orchestration is generator-agnostic (a
// `Generator` port), so swapping this for the agent path is a one-line change in
// server.ts.
import type { AppManifest, AppSpec } from "@superjam/shared";
import { specNeedsData } from "@superjam/builder/deploy";
import { selectOnchainTemplate } from "./contracts/templates.ts";
import type {
  GenerateContext,
  GeneratedApp,
  Generator,
} from "@superjam/builder/deploy";

const DEFAULT_JWKS_URL = "https://superjam.fun/.well-known/jwks.json";

// Generated apps depend on the PUBLISHED SDK (npm `superjam-sdk`), aliased to
// the `@superjam/sdk` import path so recipe/agent code is unchanged. Standalone
// `npm install` on Vercel resolves it — no monorepo, no vendored bundle.
const SDK_DEP = "npm:superjam-sdk@^0.0.1";

const manifestOf = (spec: AppSpec): AppManifest => ({
  name: spec.name,
  slug: spec.slug,
  description: spec.description,
  iconEmoji: spec.iconEmoji,
  category: spec.category,
  capabilities: spec.capabilities,
});

const packageJson = (spec: AppSpec, needsData: boolean, needsMap: boolean): string =>
  JSON.stringify(
    {
      name: spec.slug,
      private: true,
      type: "module",
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: {
        next: "^16.2.0",
        react: "^19.2.0",
        "react-dom": "^19.2.0",
        jose: "^6.0.0",
        "@superjam/sdk": SDK_DEP,
        ...(needsData
          ? {
              "@neondatabase/serverless": "^1.0.0",
              "drizzle-orm": "^0.45.0",
            }
          : {}),
        // Only when the spec carries the "map" skill — keeps the WebGL map lib
        // (~400KB) out of apps that don't render a map.
        ...(needsMap ? { "maplibre-gl": "^4.7.1" } : {}),
      },
      // Standalone Vercel build needs TS + types in the app itself (literal
      // versions only — `catalog:`/`workspace:` don't resolve off-monorepo).
      devDependencies: {
        typescript: "^5.7.0",
        "@types/node": "^22.0.0",
        "@types/react": "^19.2.0",
        "@types/react-dom": "^19.2.0",
      },
    },
    null,
    2
  );

// Self-contained tsconfig (do NOT extend the monorepo base — the app deploys
// alone). `@superjam/sdk` resolves from the published npm dep; Next's plugin +
// bundler-resolution match a stock Next 16 TS app.
const tsconfig = (): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: false,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2
  );

// Frame-ancestors authorizes the cross-origin embed; deliberately NO
// X-Frame-Options (deploy doc §D.1).
const nextConfig = (): string => `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Generated/agent code must never fail a deploy on a type nit. (Next 16
  // removed \`next lint\`, so there is no eslint key to set.)
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https://superjam.fun https://*.superjam.fun",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
`;

// Identity BAKED into source — the builder knows the appId at generate time and
// `vercel deploy` (CLI) sets no env, so SUPERJAM_APP_ID + the platform JWKS URL
// live in the source, not process.env.
const configLib = (appId: string, jwksUrl: string): string =>
  `// Baked by the SuperJam builder — the app's identity (token audience) + the
// platform JWKS. No runtime env needed.
export const SUPERJAM_APP_ID = ${JSON.stringify(appId)};
export const SUPERJAM_JWKS_URL = ${JSON.stringify(jwksUrl)};
`;

// Verify the SuperJam user token against the public JWKS (deploy doc §D.3) —
// no shared secret, no cookie. aud binds the token to THIS app.
const authLib = (): string => `import { createRemoteJWKSet, jwtVerify } from "jose";
import { SUPERJAM_APP_ID, SUPERJAM_JWKS_URL } from "./superjam-config";

const JWKS = createRemoteJWKSet(new URL(SUPERJAM_JWKS_URL));

export async function verifyUser(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    // The platform mints with issuer = its web origin (SERVICE_URLS[env].web),
    // which is the origin serving this JWKS — so derive it (dev + prod correct)
    // instead of hardcoding the prod origin.
    issuer: new URL(SUPERJAM_JWKS_URL).origin,
    audience: SUPERJAM_APP_ID,
  });
  return payload;
}
`;

const dbLib = (): string => `import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Pooled DSN injected as DATABASE_URL; neon-http is the lowest-friction
// serverless setup (no pool to leak across invocations).
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql);
`;

const pgType: Record<"string" | "number" | "boolean", string> = {
  string: 'text("{c}")',
  number: 'integer("{c}")',
  boolean: 'boolean("{c}")',
};

const schemaLib = (spec: AppSpec): string => {
  const imports = `import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";\n\n`;
  const tables = spec.data.collections.map((coll) => {
    const cols = coll.fields
      .map(({ name, type }) => `  ${name}: ${pgType[type].replace("{c}", name)},`)
      .join("\n");
    return `export const ${coll.name} = pgTable("${coll.name}", {\n  id: text("id").primaryKey(),\n${cols}\n  createdAt: timestamp("created_at").defaultNow(),\n});`;
  });
  return imports + (tables.join("\n\n") || "// no collections declared");
};

// --- Onchain games (§ builder-deploys-contracts) ---------------------------
// When the spec carries the "onchain" skill we seed a self-contained Foundry
// project the agent customizes + deploys to Arc. Everything is dependency-free
// (no OpenZeppelin / forge install) so `forge build` works offline. The deployed
// contract's OPERATOR is the platform server wallet (passed as a constructor
// arg), which is what makes sdk.onchain.write gasless + player-stamped.
const isOnchain = (spec: AppSpec): boolean => spec.skills?.includes("onchain") ?? false;

// --- Map (§ "map" skill) ---------------------------------------------------
// When the spec carries the "map" skill we seed a self-contained <TripMap>
// client component built directly on maplibre-gl (free, keyless Carto tiles).
// The build agent only edits app/page.tsx / app/api/* / lib/schema.ts, so the
// fiddly WebGL setup lives here — page.tsx just does `<TripMap stops={...} />`.
const isMap = (spec: AppSpec): boolean => spec.skills?.includes("map") ?? false;

const tripMapComponent = (): string => `"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type TripStop = {
  name: string;
  lat: number;
  lng: number;
  day?: number;
  blurb?: string;
};

// Refined Arcade palette — one hue per trip day (wraps after 6).
const DAY_COLORS = ["#3E63F2", "#FF4767", "#F5B53C", "#18B877", "#9B7BFF", "#FF8A3D"];
// Free, keyless vector basemap (CORS-enabled). No API token required.
const STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/** Renders trip stops as day-coloured numbered markers + a dashed route line,
 *  auto-fit to the itinerary. Pass stops in visit order. */
export function TripMap({ stops, height = 320 }: { stops: TripStop[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const pts = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: pts.length ? [pts[0].lng, pts[0].lat] : [0, 20],
      zoom: pts.length ? 4 : 1,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      if (pts.length >= 2) {
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: pts.map((s) => [s.lng, s.lat]) },
          },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: { "line-color": "#18151D", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.55 },
        });
      }
      const bounds = new maplibregl.LngLatBounds();
      pts.forEach((s, i) => {
        const n = s.day ?? i + 1;
        const color = DAY_COLORS[(n - 1) % DAY_COLORS.length];
        const el = document.createElement("div");
        el.style.cssText =
          "width:26px;height:26px;border-radius:50%;color:#fff;display:flex;align-items:center;" +
          "justify-content:center;font:700 13px/1 'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif;border:2px solid #fff;cursor:pointer;" +
          "box-shadow:0 2px 6px rgba(0,0,0,.3);background:" + color;
        el.textContent = String(n);
        const popup = new maplibregl.Popup({ offset: 18, closeButton: false }).setHTML(
          "<strong>" + escapeHtml(s.name) + "</strong>" +
            (s.blurb ? '<br/><span style="font-size:12px">' + escapeHtml(s.blurb) + "</span>" : "")
        );
        new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(popup).addTo(map);
        bounds.extend([s.lng, s.lat]);
      });
      if (pts.length === 1) {
        map.setCenter([pts[0].lng, pts[0].lat]);
        map.setZoom(9);
      } else if (pts.length > 1) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 9, duration: 0 });
      }
    });

    return () => map.remove();
  }, [stops]);

  return <div ref={ref} style={{ width: "100%", height, borderRadius: 16, overflow: "hidden" }} />;
}
`;

const foundryToml = (): string => `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
`;

// The seeded Game.sol is a VETTED, parameterized template (chance / pvp / collectible)
// filled from the spec by selectOnchainTemplate — NOT free-hand Solidity. The harness's
// onchain kit overlays the matching template + a starter page; this seed is the same
// contract for the agent path / no-kit builds, so neither path authors Solidity.

// Compile + deploy to Arc, print {"address","abi"} as JSON (the agent reads this,
// writes lib/contract.ts, and reports contractAddress/contractAbi). Operator =
// ARC_OPERATOR_ADDRESS (the platform server wallet) so relayed writes pass onlyOperator.
const deploySh = (): string => `#!/usr/bin/env bash
# Deploy the game contract to Arc and print {"address","abi"} as JSON.
# Env: ARC_DEPLOYER_KEY (funded with Arc USDC for gas),
#      ARC_OPERATOR_ADDRESS (the SuperJam server wallet = the contract operator),
#      ARC_RPC_URL (optional; defaults to the Arc testnet RPC).
set -euo pipefail
cd "$(dirname "$0")"
# forge lives in ~/.foundry/bin, which isn't on the builder service PATH.
export PATH="$HOME/.foundry/bin:$PATH"
: "\${ARC_RPC_URL:=https://rpc.testnet.arc.network}"
forge build --silent
# NOTE: --constructor-args is variadic — it MUST be the last flag (else it eats
# the next flag as a 2nd arg). --json goes before it for parseable deploy output.
ADDR=$(forge create src/Game.sol:Game \\
  --rpc-url "$ARC_RPC_URL" \\
  --private-key "$ARC_DEPLOYER_KEY" \\
  --broadcast \\
  --json \\
  --constructor-args "$ARC_OPERATOR_ADDRESS" | jq -r '.deployedTo')
jq -nc --arg a "$ADDR" --argjson abi "$(jq -c '.abi' out/Game.sol/Game.json)" \\
  '{address:$a, abi:$abi}'
`;

const page = (spec: AppSpec): string => `export default function Page() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>${spec.iconEmoji} ${spec.name.replace(/"/g, "&quot;")}</h1>
      <p>${spec.description.replace(/"/g, "&quot;")}</p>
      <ul>
${spec.features.map((f) => `        <li>${f.replace(/</g, "&lt;")}</li>`).join("\n")}
      </ul>
    </main>
  );
}
`;

// Root layout — ships the immersive Stage theme + Bricolage Grotesque so a framed jam
// renders on the dark glow stage. theme.css is the LOCKED design system
// (DO-NOT-EDIT); globals.css is the agent's scratch sheet, imported AFTER so its
// additions layer on top without being able to replace the theme's tokens/body.
const layout = (spec: AppSpec): string => `import "./theme.css";
import "./globals.css";

export const metadata = { title: "${spec.name.replace(/"/g, "")}" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
`;

// Deployed-tier "Stage" theme — the LOCKED immersive design system seeded as
// app/theme.css and imported first in layout.tsx. An atmospheric DARK stage: a fixed
// glow-mesh + grain background, translucent glass surfaces, accent glow, and entrance
// motion — so even a model-built jam looks high-craft just by composing .tj-* classes.
// Mirrors the .tj-* contract in packages/app-template/src/theme.css (keep the var
// names + every .tj-* class NAME in sync; values may differ for the centered preview).
// The agent is told NOT to edit this file (gate-enforced) — custom CSS goes in the
// globals.css scratch sheet — so the dark stage can never be clobbered into light-on-light.
const themeCss = (): string => `:root {
  /* Immersive dark stage — not pure black; an ink-indigo with depth. */
  --bg: #0A0A12;
  --bg-2: #12121E;
  /* Glass surfaces — translucent light over the stage. */
  --card: rgba(255, 255, 255, 0.045);
  --card-border: rgba(255, 255, 255, 0.10);
  --card-highlight: rgba(255, 255, 255, 0.06);
  --line: rgba(255, 255, 255, 0.10);
  /* Ink — light on dark. */
  --text: #F5F4FA;
  --muted: #9B97AD;
  /* Accents — brand pink kept; the rest brightened so they glow on dark. */
  --accent: #FF4767;
  --yellow: #F5B53C;
  --green: #18C480;
  --blue: #5B7BFF;
  --danger: #FF5A5F;
  --radius: 16px;
  /* deep ambient elevation for glass + an accent-colored glow */
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.35), 0 24px 60px -22px rgba(0, 0, 0, 0.65);
  --glow-accent: 0 10px 30px -6px rgba(255, 71, 103, 0.55), 0 0 0 1px rgba(255, 71, 103, 0.28);
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
* { box-sizing: border-box; }
html, body { -webkit-tap-highlight-color: transparent; }
body {
  margin: 0;
  font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text);
  min-height: 100dvh;
  /* The atmosphere: a fixed glow-mesh (accent + blue + green) over the ink stage,
     plus a faint film grain on top — depth behind every jam, zero asset deps. */
  background-color: var(--bg);
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E"),
    radial-gradient(60% 50% at 12% -5%, rgba(255, 71, 103, 0.22), transparent 70%),
    radial-gradient(55% 45% at 100% 8%, rgba(91, 123, 255, 0.20), transparent 72%),
    radial-gradient(60% 50% at 50% 108%, rgba(24, 196, 128, 0.12), transparent 72%);
  background-repeat: repeat, no-repeat, no-repeat, no-repeat;
  background-attachment: fixed, fixed, fixed, fixed;
  background-size: 140px 140px, auto, auto, auto;
}
/* Responsive readable column — mobile-first, widens on desktop so jams use the
   space instead of a skinny phone strip. Toys can nest a single tj-card. */
.tj-app { max-width: 560px; margin: 0 auto; padding: 20px 16px 32px; }
@media (min-width: 768px) {
  .tj-app { max-width: 720px; padding: 32px 24px 48px; }
}

/* ── Opening toolkit — pick the one that FITS the app (the kit sets a default; the
   page never pastes a bright full-bleed banner — that fights the dark stage):
   • .tj-hero     — a glowing TITLE that sits on the dark stage (no slab, no box): a
     gradient-clipped title + a soft radial glow that melts into --bg. The "title
     screen" open for generators / quizzes / roasts.
   • .tj-hero-art — a baked image whose edges FADE into the dark (mask), with the title
     overlaid. The atmospheric open for travel / photo / visual jams.
   • (no opening) — games & polls just open on the HUD / ballot, with a compact
     .tj-header inside the first card. */
.tj-hero {
  position: relative;
  margin: 4px 0 18px;
  padding: 22px 12px 8px;
  text-align: center;
  background: radial-gradient(60% 78% at 50% 22%, rgba(255, 71, 103, 0.16), rgba(91, 123, 255, 0.09) 50%, transparent 72%);
}
.tj-hero .tj-title {
  font-size: 34px; line-height: 1.04; letter-spacing: -0.03em;
  background: linear-gradient(120deg, #fff 8%, var(--accent) 52%, var(--blue));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 22px rgba(255, 71, 103, 0.30));
}
.tj-hero .tj-sub { color: var(--muted); margin-top: 6px; }
@media (min-width: 768px) {
  .tj-hero { padding: 32px 12px 10px; }
  .tj-hero .tj-title { font-size: 44px; }
}

/* Art opening — a baked hero image that melts into the stage at its edges. Put an
   <img src="/hero.png"> (or a .tj-hero-bg div with a background-image) as the FIRST
   child, then the .tj-title / .tj-sub. */
.tj-hero-art {
  position: relative; overflow: hidden;
  margin: -20px -16px 18px;
  min-height: 200px;
  display: grid; align-content: end; justify-items: center; gap: 2px;
  padding: 22px 20px 18px; text-align: center;
}
.tj-hero-art > img, .tj-hero-art > .tj-hero-bg {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; z-index: 0;
  -webkit-mask-image: linear-gradient(to bottom, #000 35%, transparent 97%);
  mask-image: linear-gradient(to bottom, #000 35%, transparent 97%);
}
.tj-hero-art > .tj-title, .tj-hero-art > .tj-sub { position: relative; z-index: 1; }
.tj-hero-art .tj-title { color: #fff; font-size: 32px; text-shadow: 0 2px 18px rgba(0, 0, 0, 0.6); }
.tj-hero-art .tj-sub { color: rgba(255, 255, 255, 0.85); }
@media (min-width: 768px) {
  .tj-hero-art { margin: -32px -24px 22px; min-height: 248px; }
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */
.tj-card {
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: var(--radius);
  padding: 20px;
  width: 100%;
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  box-shadow: var(--shadow), inset 0 1px 0 var(--card-highlight);
}
.tj-card + .tj-card { margin-top: 14px; }

/* Header row — emoji chip + title/sub (+ optional right slot via .tj-spacer).
   Keep it COMPACT: the host already shows the jam name in its title pill, so don't
   repeat it as a giant top heading. */
.tj-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.tj-emoji {
  flex: none; display: grid; place-items: center;
  width: 46px; height: 46px; font-size: 26px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--card-border); border-radius: 13px;
  box-shadow: inset 0 1px 0 var(--card-highlight);
}
.tj-htext { min-width: 0; }
.tj-spacer { margin-left: auto; }

.tj-title { margin: 0; font-size: 22px; font-weight: 800; line-height: 1.1; letter-spacing: -0.025em; }
.tj-sub { margin: 4px 0 0; color: var(--muted); font-size: 14px; font-weight: 500; }
.tj-muted { color: var(--muted); }

/* ── Buttons ────────────────────────────────────────────────────────────── */
.tj-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 13px 18px;
  font-weight: 700;
  cursor: pointer;
  font-size: 15px;
  font-family: inherit;
  letter-spacing: -0.01em;
  box-shadow: var(--glow-accent);
  transition: transform .16s var(--ease-spring), box-shadow .16s var(--ease-out), filter .14s ease;
}
.tj-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
.tj-btn:active { transform: scale(0.97); }
.tj-btn:disabled { background: rgba(255, 255, 255, 0.07); color: var(--muted); cursor: not-allowed; transform: none; filter: none; box-shadow: none; }
.tj-btn-ghost { background: rgba(255, 255, 255, 0.05); color: var(--text); border: 1px solid var(--card-border); box-shadow: inset 0 1px 0 var(--card-highlight); }
.tj-btn-ghost:hover { background: rgba(255, 255, 255, 0.09); }
.tj-btn-yellow { background: var(--yellow); color: #1a1410; box-shadow: 0 10px 30px -6px rgba(245, 181, 60, 0.5); }
.tj-btn-green { background: var(--green); color: #042016; box-shadow: 0 10px 30px -6px rgba(24, 196, 128, 0.5); }
.tj-btn-blue { background: var(--blue); color: #fff; box-shadow: 0 10px 30px -6px rgba(91, 123, 255, 0.5); }
.tj-btn-block { display: block; width: 100%; }

/* ── Inputs ─────────────────────────────────────────────────────────────── */
.tj-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--card-border);
  color: var(--text);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  font-family: inherit;
  font-weight: 500;
  transition: border-color .12s ease, box-shadow .12s ease, background .12s ease;
}
.tj-input::placeholder { color: var(--muted); }
.tj-input:focus { outline: none; border-color: var(--accent); background: rgba(255, 255, 255, 0.06); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }

/* ── Segmented choice picker — a row/grid of glass options; the picked one fills with
   accent + glow. Use \`aria-pressed={selected}\` (or add .is-on) on each .tj-choice. ── */
.tj-choices { display: grid; gap: 8px; }
.tj-choices.tj-cols-2 { grid-template-columns: 1fr 1fr; }
.tj-choice {
  appearance: none; cursor: pointer; text-align: center;
  background: rgba(255, 255, 255, 0.05); color: var(--text);
  border: 1px solid var(--card-border); border-radius: 12px;
  padding: 14px; font-family: inherit; font-weight: 600; font-size: 15px;
  letter-spacing: -0.01em;
  box-shadow: inset 0 1px 0 var(--card-highlight);
  transition: transform .16s var(--ease-spring), box-shadow .16s var(--ease-out), border-color .12s ease, background .12s ease;
}
.tj-choice:hover { background: rgba(255, 255, 255, 0.09); border-color: rgba(255, 255, 255, 0.2); }
.tj-choice:active { transform: scale(0.98); }
.tj-choice[aria-pressed="true"], .tj-choice.is-on { background: var(--accent); color: #fff; border-color: transparent; box-shadow: var(--glow-accent); }
.tj-choice:disabled { cursor: default; }

/* ── Result / progress bar — dark track with a glowing gradient fill.
   <div class="tj-bar"><div class="tj-bar-fill" style="width:60%"></div>
     <div class="tj-bar-label"><span>Cats</span><span>60%</span></div></div> ── */
.tj-bar {
  position: relative; height: 32px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--card-border); border-radius: 11px;
  overflow: hidden;
}
.tj-bar-fill {
  position: absolute; inset: 0 auto 0 0; width: 0%;
  background: linear-gradient(90deg, var(--accent), var(--blue));
  box-shadow: 0 0 24px -2px var(--accent);
  transition: width .55s var(--ease-out);
}
.tj-bar-label {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 0 12px;
  font-weight: 700; font-size: 13px;
}

/* ── Layout helpers ─────────────────────────────────────────────────────── */
.tj-row { display: flex; gap: 8px; align-items: center; }
.tj-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tj-center { display: grid; place-items: center; text-align: center; gap: 8px; }
.tj-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.tj-list > li { display: flex; gap: 8px; align-items: center; }
/* Responsive collection grid — 1 column on phones, auto-fills more columns as the
   screen widens. Use for galleries, item lists, card decks (the RESPONSIVE default
   for any collection so jams fill desktop width instead of a single skinny column). */
.tj-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }

/* ── Bits ───────────────────────────────────────────────────────────────── */
/* Big stat reads as a glowing gradient numeral — a small wow moment. */
.tj-stat {
  font-size: 46px; font-weight: 800; line-height: 1; letter-spacing: -0.03em;
  background: linear-gradient(135deg, #fff, var(--accent));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.tj-badge {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(255, 255, 255, 0.06); border: 1px solid var(--card-border); border-radius: 999px;
  padding: 3px 11px; font-size: 12px; font-weight: 600;
}
.tj-pill {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--accent); color: #fff; border-radius: 999px;
  padding: 3px 11px; font-size: 12px; font-weight: 700;
  box-shadow: var(--glow-accent);
}
.tj-empty { display: grid; place-items: center; gap: 6px; padding: 28px 12px; color: var(--muted); font-weight: 500; text-align: center; }

/* ── Spinner ────────────────────────────────────────────────────────────── */
.tj-spin { width: 22px; height: 22px; border: 3px solid rgba(255, 255, 255, 0.12); border-top-color: var(--accent); border-radius: 50%; animation: tj-rot .7s linear infinite; }
@keyframes tj-rot { to { transform: rotate(360deg); } }

/* ── Full-bleed game stage (escapes the column; put a <canvas> inside, overlay
   UI with .tj-hud) ──────────────────────────────────────────────────────── */
.tj-stage { position: fixed; inset: 0; overflow: hidden; }
.tj-hud { position: absolute; inset: 0; pointer-events: none; }
.tj-hud > * { pointer-events: auto; }

/* ── Entrance choreography — content RISES in; .tj-stagger cascades its children so
   a screen assembles itself instead of snapping in. Add .tj-rise to one element, or
   wrap a column in .tj-stagger. ──────────────────────────────────────────── */
@keyframes tj-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.tj-rise { animation: tj-rise .55s var(--ease-out) both; }
.tj-stagger > * { animation: tj-rise .55s var(--ease-out) both; }
.tj-stagger > *:nth-child(1) { animation-delay: .04s; }
.tj-stagger > *:nth-child(2) { animation-delay: .10s; }
.tj-stagger > *:nth-child(3) { animation-delay: .16s; }
.tj-stagger > *:nth-child(4) { animation-delay: .22s; }
.tj-stagger > *:nth-child(5) { animation-delay: .28s; }
.tj-stagger > *:nth-child(6) { animation-delay: .34s; }
.tj-stagger > *:nth-child(n+7) { animation-delay: .40s; }

/* A reusable accent glow + a shimmer sweep for hero art / winning states. */
.tj-glow { box-shadow: var(--glow-accent); }
@keyframes tj-shimmer { to { background-position: 200% 0; } }
.tj-shimmer {
  background-image: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.5) 50%, transparent 70%);
  background-size: 200% 100%;
  animation: tj-shimmer 2.4s linear infinite;
}

/* ── Juice (event-driven one-shots; key the element to replay) ──────────── */
@keyframes tj-pop { 50% { transform: scale(1.25); } }
.tj-pop { animation: tj-pop .18s ease; }
@keyframes tj-shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
.tj-shake { animation: tj-shake .15s linear 2; }
@keyframes tj-celebrate { 0% { transform: scale(.8); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
.tj-celebrate { animation: tj-celebrate .5s var(--ease-spring) both; }

/* Respect reduced-motion — kill entrance + ambient loops, keep functional fills. */
@media (prefers-reduced-motion: reduce) {
  .tj-rise, .tj-stagger > *, .tj-celebrate { animation: none; }
  .tj-shimmer { animation: none; }
}
`;

// The agent's editable scratch stylesheet — seeded near-empty and imported AFTER
// theme.css. Custom, app-specific CSS goes here; the locked theme stays untouched.
const globalsScratch = (): string => `/* Your app-specific CSS goes here.
 *
 * The immersive Stage theme is ALREADY loaded from theme.css — a DARK glow-mesh --bg,
 * light --text, --accent, Bricolage Grotesque, glass .tj-card, .tj-hero, and every
 * .tj-* component class (.tj-btn, .tj-input, .tj-choice, .tj-bar, .tj-stat, .tj-badge,
 * .tj-pill, plus .tj-rise / .tj-stagger entrance motion). Compose with those — add only
 * NEW classes here.
 *
 * DO NOT restyle 'body', ':root', or any '.tj-*' class, and NEVER set a LIGHT page
 * background — the stage is dark by design (light text on a dark glow). A vivid hero
 * band is fine; a light/white page or dark-on-dark text is not.
 */
`;

/** Build the deterministic file map for one app. `ctx` carries the baked
 * identity (appId + JWKS); absent in unit tests that don't deploy. */
export const generateApp = (spec: AppSpec, ctx?: GenerateContext): GeneratedApp => {
  const needsData = specNeedsData(spec);
  const needsMap = isMap(spec);
  const files: Record<string, string> = {
    "package.json": packageJson(spec, needsData, needsMap),
    "tsconfig.json": tsconfig(),
    "next.config.ts": nextConfig(),
    "superjam.json": JSON.stringify(manifestOf(spec), null, 2),
    "lib/superjam-config.ts": configLib(
      ctx?.appId ?? "",
      ctx?.jwksUrl ?? DEFAULT_JWKS_URL
    ),
    "app/layout.tsx": layout(spec),
    "app/theme.css": themeCss(), // LOCKED Studio design system (layout imports it first)
    "app/globals.css": globalsScratch(), // agent scratch sheet (imported after theme.css)
    "app/page.tsx": page(spec),
    "lib/auth.ts": authLib(),
  };
  if (needsData) {
    files["lib/db.ts"] = dbLib();
    files["lib/schema.ts"] = schemaLib(spec);
  }
  if (needsMap) {
    files["components/trip-map.tsx"] = tripMapComponent();
  }
  if (isOnchain(spec)) {
    files["contracts/foundry.toml"] = foundryToml();
    files["contracts/src/Game.sol"] = selectOnchainTemplate(spec).contract(spec);
    files["contracts/deploy.sh"] = deploySh();
    // Keep the Solidity project + forge artifacts out of the Vercel upload.
    files[".vercelignore"] = "contracts/\n";
  }
  return { files, manifest: manifestOf(spec), needsData, prebuilt: false };
};

/** The `Generator` port impl. Async to match the agent-fill signature. */
export const createTemplateGenerator = (): Generator => async (spec, ctx) =>
  generateApp(spec, ctx);
