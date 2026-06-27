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
const DAY_COLORS = ["#3E63F2", "#FF4767", "#FFC23D", "#18C480", "#9B7BFF", "#FF8A3D"];
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
          paint: { "line-color": "#17131F", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.55 },
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

// Root layout — ships the Toybox theme so a framed jam looks native in the host
// (same Bricolage Grotesque font + tokens as apps/web). theme.css is the LOCKED design system
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

// Deployed-tier Toybox theme — the LOCKED design system seeded as app/theme.css and
// imported first in layout.tsx. Matches the host + the SDK \`tj-*\` contract in
// packages/app-template/src/theme.css (keep the --bg/--card/--text/--muted/--accent/
// --danger/--radius vars + all .tj-* class NAMES in sync; only values may differ).
// Tuned for FULL-WIDTH content pages: the body flows normally (no forced centering),
// \`.tj-app\` is the readable column, and \`.tj-card\` drops the toy width cap.
// The agent is told NOT to edit this file (gate-enforced) — custom CSS goes in the
// globals.css scratch sheet — so the theme can never be clobbered into dark-on-dark.
const themeCss = (): string => `:root {
  --bg: #F6F4EC;     /* cream paper */
  --card: #FFFFFF;   /* card face */
  --text: #17131F;   /* ink — text AND outlines/shadows */
  --muted: #6A6475;
  --accent: #FF4767; /* primary */
  --yellow: #FFC23D;
  --green: #18C480;
  --blue: #3E63F2;
  --danger: #E5484D;
  --radius: 14px;
  /* layered depth: a crisp ink offset + a soft ambient drop (never a flat slab) */
  --shadow: 0 3px 0 var(--text), 0 12px 24px -10px rgba(23, 19, 31, 0.24);
}
* { box-sizing: border-box; }
html, body { -webkit-tap-highlight-color: transparent; }
body {
  margin: 0;
  font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text);
  background-color: var(--bg);
  /* whisper-quiet dot-grid for paper depth — never a busy pattern */
  background-image: radial-gradient(rgba(23, 19, 31, 0.03) 1px, transparent 1.7px);
  background-size: 22px 22px;
  background-position: -11px -11px;
  min-height: 100dvh;
}
/* Mobile-first readable column for content jams. Toys can nest a single tj-card. */
.tj-app { max-width: 560px; margin: 0 auto; padding: 20px 16px 32px; }

/* ── Hero / first-page band — gives a jam's FIRST screen its own identity instead
   of a bare card. Bleeds full-width past the .tj-app padding; white text on a vivid
   gradient stays high-contrast. Drop a .tj-title + .tj-sub (or a baked
   <img src="/hero.png">) inside. This is a contained band, NOT a dark page
   background — the page itself stays cream. Override the gradient with an inline
   \`style\` or a new globals.css class for per-jam art. */
.tj-hero {
  margin: -20px -16px 18px;
  padding: 30px 22px;
  color: #fff;
  text-align: center;
  background: linear-gradient(135deg, var(--accent), var(--blue));
  box-shadow: 0 3px 0 var(--text);
}
.tj-hero .tj-sub { color: #fff; opacity: .92; }

/* ── Surfaces ───────────────────────────────────────────────────────────── */
.tj-card {
  background: var(--card);
  border: 1.5px solid var(--text);
  border-radius: var(--radius);
  padding: 20px;
  width: 100%;
  box-shadow: var(--shadow);
}
.tj-card + .tj-card { margin-top: 14px; }

/* Header row — emoji chip + title/sub (+ optional right slot via .tj-spacer).
   Keep it COMPACT: the host already shows the jam name in its title pill, so don't
   repeat it as a giant top heading. */
.tj-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.tj-emoji {
  flex: none; display: grid; place-items: center;
  width: 46px; height: 46px; font-size: 26px;
  background: var(--bg); border: 1.5px solid var(--text); border-radius: 13px;
  box-shadow: 0 2px 0 var(--text);
}
.tj-htext { min-width: 0; }
.tj-spacer { margin-left: auto; }

.tj-title { margin: 0; font-size: 22px; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; }
.tj-sub { margin: 4px 0 0; color: var(--muted); font-size: 14px; font-weight: 500; }
.tj-muted { color: var(--muted); }

/* ── Buttons ────────────────────────────────────────────────────────────── */
.tj-btn {
  background: var(--accent);
  color: #fff;
  border: 1.5px solid var(--text);
  border-radius: 12px;
  padding: 12px 16px;
  font-weight: 700;
  cursor: pointer;
  font-size: 15px;
  font-family: inherit;
  letter-spacing: -0.01em;
  box-shadow: 0 2px 0 var(--text), 0 6px 14px -6px rgba(23, 19, 31, 0.26);
  transition: transform .12s cubic-bezier(0.23,1,0.32,1), box-shadow .12s cubic-bezier(0.23,1,0.32,1), filter .12s ease;
}
.tj-btn:hover { filter: brightness(1.04); }
.tj-btn:active { transform: translateY(2px); box-shadow: 0 0 0 var(--text); }
.tj-btn:disabled { opacity: .5; cursor: not-allowed; box-shadow: 0 2px 0 var(--text); transform: none; filter: none; }
.tj-btn-ghost { background: var(--card); color: var(--text); }
.tj-btn-yellow { background: var(--yellow); color: var(--text); }
.tj-btn-green { background: var(--green); color: #fff; }
.tj-btn-blue { background: var(--blue); color: #fff; }
.tj-btn-block { display: block; width: 100%; }

/* ── Inputs ─────────────────────────────────────────────────────────────── */
.tj-input {
  width: 100%;
  background: #fff;
  border: 1.5px solid var(--text);
  color: var(--text);
  border-radius: 12px;
  padding: 11px 13px;
  font-size: 14px;
  font-family: inherit;
  font-weight: 500;
}
.tj-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

/* ── Segmented choice picker — a row/grid of options; the picked one fills with
   accent. Use \`aria-pressed={selected}\` (or add .is-on) on each .tj-choice. ── */
.tj-choices { display: grid; gap: 8px; }
.tj-choices.tj-cols-2 { grid-template-columns: 1fr 1fr; }
.tj-choice {
  appearance: none; cursor: pointer; text-align: center;
  background: var(--card); color: var(--text);
  border: 1.5px solid var(--text); border-radius: 12px;
  padding: 12px 14px; font-family: inherit; font-weight: 700; font-size: 15px;
  letter-spacing: -0.01em;
  box-shadow: 0 2px 0 var(--text), 0 5px 12px -6px rgba(23, 19, 31, 0.22);
  transition: transform .12s cubic-bezier(0.23,1,0.32,1), box-shadow .12s cubic-bezier(0.23,1,0.32,1);
}
.tj-choice:active { transform: translateY(2px); box-shadow: 0 0 0 var(--text); }
.tj-choice[aria-pressed="true"], .tj-choice.is-on { background: var(--accent); color: #fff; }
.tj-choice:disabled { cursor: default; }

/* ── Result / progress bar — ink-bordered track with an animated fill.
   <div class="tj-bar"><div class="tj-bar-fill" style="width:60%"></div>
     <div class="tj-bar-label"><span>Cats</span><span>60%</span></div></div> ── */
.tj-bar {
  position: relative; height: 32px;
  background: var(--bg); border: 1.5px solid var(--text); border-radius: 10px;
  overflow: hidden;
}
.tj-bar-fill {
  position: absolute; inset: 0 auto 0 0; width: 0%;
  background: var(--accent);
  transition: width .5s cubic-bezier(.2, .8, .2, 1);
}
.tj-bar-label {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 0 10px;
  font-weight: 700; font-size: 13px;
}

/* ── Layout helpers ─────────────────────────────────────────────────────── */
.tj-row { display: flex; gap: 8px; align-items: center; }
.tj-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tj-center { display: grid; place-items: center; text-align: center; gap: 8px; }
.tj-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.tj-list > li { display: flex; gap: 8px; align-items: center; }

/* ── Bits ───────────────────────────────────────────────────────────────── */
.tj-stat { font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -0.03em; }
.tj-badge {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--bg); border: 1.5px solid var(--text); border-radius: 999px;
  padding: 2px 10px; font-size: 12px; font-weight: 600;
}
.tj-pill {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--accent); color: #fff; border-radius: 999px;
  padding: 3px 10px; font-size: 12px; font-weight: 700;
}
.tj-empty { display: grid; place-items: center; gap: 6px; padding: 28px 12px; color: var(--muted); font-weight: 500; text-align: center; }

/* ── Spinner ────────────────────────────────────────────────────────────── */
.tj-spin { width: 22px; height: 22px; border: 3px solid var(--bg); border-top-color: var(--accent); border-radius: 50%; animation: tj-rot .7s linear infinite; }
@keyframes tj-rot { to { transform: rotate(360deg); } }

/* ── Full-bleed game stage (escapes the column; put a <canvas> inside, overlay
   UI with .tj-hud) ──────────────────────────────────────────────────────── */
.tj-stage { position: fixed; inset: 0; overflow: hidden; }
.tj-hud { position: absolute; inset: 0; pointer-events: none; }
.tj-hud > * { pointer-events: auto; }

/* ── Juice (event-driven one-shots; key the element to replay) ──────────── */
@keyframes tj-pop { 50% { transform: scale(1.25); } }
.tj-pop { animation: tj-pop .18s ease; }
@keyframes tj-shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
.tj-shake { animation: tj-shake .15s linear 2; }
`;

// The agent's editable scratch stylesheet — seeded near-empty and imported AFTER
// theme.css. Custom, app-specific CSS goes here; the locked theme stays untouched.
const globalsScratch = (): string => `/* Your app-specific CSS goes here.
 *
 * The Toybox theme is ALREADY loaded from theme.css — cream --bg, ink --text,
 * --accent, Bricolage Grotesque, and every .tj-* component class (.tj-card, .tj-btn,
 * .tj-input, .tj-header, .tj-choice, .tj-bar, .tj-stat, .tj-badge, .tj-pill, …).
 * Compose with those. Add only NEW classes here.
 *
 * DO NOT restyle 'body', ':root', or any '.tj-*' class, and NEVER set a dark page
 * background — the app must stay cream paper with ink text (high contrast).
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
    "app/theme.css": themeCss(), // LOCKED Toybox design system (layout imports it first)
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
