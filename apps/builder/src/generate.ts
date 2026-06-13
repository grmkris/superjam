// Template generator (pivot §6 "(a) Generate"). Produces a deployable Next.js
// 16 app dir from an AppSpec as a file map. This is the DETERMINISTIC bootstrap
// fill — a valid skeleton (framed-by-superjam headers, optional Neon+Drizzle
// data layer, JWKS verify) that the agent-enhanced fill and Opus B's richer
// Next+SDK template supersede. The orchestration is generator-agnostic (a
// `Generator` port), so swapping this for the agent path is a one-line change in
// server.ts.
import type { AppManifest, AppSpec } from "@superjam/shared";
import { specNeedsData } from "@superjam/builder/deploy";
import type { GeneratedApp, Generator } from "@superjam/builder/deploy";

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

// Verify the SuperJam user token against the public JWKS (deploy doc §D.3) —
// no shared secret, no cookie. aud binds the token to THIS app.
const authLib = (): string => `import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL(process.env.SUPERJAM_JWKS_URL!));

export async function verifyUser(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://superjam.fun",
    audience: process.env.SUPERJAM_APP_ID,
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
    const cols = Object.entries(coll.doc)
      .map(([k, t]) => `  ${k}: ${pgType[t].replace("{c}", k)},`)
      .join("\n");
    return `export const ${coll.name} = pgTable("${coll.name}", {\n  id: text("id").primaryKey(),\n${cols}\n  createdAt: timestamp("created_at").defaultNow(),\n});`;
  });
  return imports + (tables.join("\n\n") || "// no collections declared");
};

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

/** Build the deterministic file map for one app. */
export const generateApp = (spec: AppSpec): GeneratedApp => {
  const needsData = specNeedsData(spec);
  const files: Record<string, string> = {
    "package.json": packageJson(spec, needsData),
    "tsconfig.json": tsconfig(),
    "next.config.ts": nextConfig(),
    "superjam.json": JSON.stringify(manifestOf(spec), null, 2),
    "app/layout.tsx": layout(spec),
    "app/page.tsx": page(spec),
    "lib/auth.ts": authLib(),
  };
  if (needsData) {
    files["lib/db.ts"] = dbLib();
    files["lib/schema.ts"] = schemaLib(spec);
  }
  return { files, manifest: manifestOf(spec), needsData, prebuilt: false };
};

/** The `Generator` port impl. Async to match the agent-fill signature. */
export const createTemplateGenerator = (): Generator => async (spec) =>
  generateApp(spec);
