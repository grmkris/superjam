// Template generator (pivot §6 "(a) Generate"). Produces a deployable Next.js
// 16 app dir from an AppSpec as a file map. This is the DETERMINISTIC bootstrap
// fill — a valid skeleton (framed-by-superjam headers, optional Neon+Drizzle
// data layer, JWKS verify) that the agent-enhanced fill and Opus B's richer
// Next+SDK template supersede. The orchestration is generator-agnostic (a
// `Generator` port), so swapping this for the agent path is a one-line change in
// server.ts.
import type { AppManifest, AppSpec } from "@superjam/shared";
import { specNeedsData } from "@superjam/builder/deploy";
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

const packageJson = (spec: AppSpec, needsData: boolean): string =>
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

const foundryToml = (): string => `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
`;

// A minimal operator-gated coinflip — the base the agent adapts per the onchain
// recipe. Mutators take \`address player\` FIRST (the platform stamps it) and are
// onlyOperator; reads are open. Self-contained: no imports.
const gameSol = (): string => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// SuperJam onchain game. The platform server wallet is the \`operator\`: it relays
/// player moves (sdk.onchain.write) and stamps the real \`player\`. Reads are open
/// (sdk.onchain.read). Adapt this contract to your game; keep it operator-gated.
contract Game {
    address public operator;
    mapping(address => uint8) public lastFlip; // 0 none, 1 heads, 2 tails
    mapping(address => uint256) public wins;
    uint256 public totalFlips;

    event Flipped(address indexed player, uint8 guess, uint8 result, bool won);

    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }

    /// guess: 1 = heads, 2 = tails. Block-based pseudo-random — fine for a toy.
    function flip(address player, uint8 guess) external onlyOperator {
        uint8 result = uint8(uint256(keccak256(abi.encodePacked(block.prevrandao, player, totalFlips))) % 2) + 1;
        bool won = guess == result;
        lastFlip[player] = result;
        if (won) wins[player] += 1;
        totalFlips += 1;
        emit Flipped(player, guess, result, won);
    }

    function statsOf(address player) external view returns (uint8 last, uint256 won) {
        return (lastFlip[player], wins[player]);
    }
}
`;

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

const layout = (spec: AppSpec): string => `export const metadata = { title: "${spec.name.replace(/"/g, "")}" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

/** Build the deterministic file map for one app. `ctx` carries the baked
 * identity (appId + JWKS); absent in unit tests that don't deploy. */
export const generateApp = (spec: AppSpec, ctx?: GenerateContext): GeneratedApp => {
  const needsData = specNeedsData(spec);
  const files: Record<string, string> = {
    "package.json": packageJson(spec, needsData),
    "tsconfig.json": tsconfig(),
    "next.config.ts": nextConfig(),
    "superjam.json": JSON.stringify(manifestOf(spec), null, 2),
    "lib/superjam-config.ts": configLib(
      ctx?.appId ?? "",
      ctx?.jwksUrl ?? DEFAULT_JWKS_URL
    ),
    "app/layout.tsx": layout(spec),
    "app/page.tsx": page(spec),
    "lib/auth.ts": authLib(),
  };
  if (needsData) {
    files["lib/db.ts"] = dbLib();
    files["lib/schema.ts"] = schemaLib(spec);
  }
  if (isOnchain(spec)) {
    files["contracts/foundry.toml"] = foundryToml();
    files["contracts/src/Game.sol"] = gameSol();
    files["contracts/deploy.sh"] = deploySh();
    // Keep the Solidity project + forge artifacts out of the Vercel upload.
    files[".vercelignore"] = "contracts/\n";
  }
  return { files, manifest: manifestOf(spec), needsData, prebuilt: false };
};

/** The `Generator` port impl. Async to match the agent-fill signature. */
export const createTemplateGenerator = (): Generator => async (spec, ctx) =>
  generateApp(spec, ctx);
