import { describe, expect, test } from "bun:test";
import type { AppSpec } from "@superjam/shared";
import type {
  DeployPort,
  GeneratedApp,
  NeonClient,
  TeardownArgs,
  TeardownResult,
} from "@superjam/builder/deploy";
import { createBuilderApp } from "./app.ts";
import { generateApp } from "./generate.ts";
import { createBuildRunner } from "./queue.ts";

const TOKEN = "secret-token";

const spec: AppSpec = {
  name: "Tip Jar",
  slug: "tip-jar",
  description: "Send a USDC tip.",
  iconEmoji: "💸",
  category: "tool",
  capabilities: ["payments"],
  features: ["Tip button"],
  data: { collections: [], counters: [], storage: [] },
  ui: { layout: "one column", sections: ["tip"] },
  acceptance: ["Tipping works"],
};

const dataSpec: AppSpec = {
  ...spec,
  slug: "wall",
  data: {
    collections: [
      { name: "posts", doc: { text: "string", score: "number" }, writtenWhen: "post" },
    ],
    counters: [],
    storage: [],
  },
};

const stubDeploy: DeployPort = async ({ name }) => ({
  entryUrl: `https://${name}.vercel.app`,
  deploymentId: "dpl_1",
});

const stubNeon = (): NeonClient => ({
  createProject: async () => ({
    projectId: "neon_1",
    pooledDsn: "postgres://pooled?sslmode=require",
    directDsn: "postgres://direct?sslmode=require",
  }),
  deleteProject: async () => {},
});

const makeApp = (overrides?: {
  generate?: () => Promise<GeneratedApp>;
  maxConcurrent?: number;
  noTeardown?: boolean;
}) => {
  const runner = createBuildRunner({
    generate: overrides?.generate ?? (async (s) => generateApp(s)),
    deploy: stubDeploy,
    teardownVercel: async () => {},
    neon: stubNeon(),
    jwksUrl: "https://superjam.fun/.well-known/jwks.json",
    maxConcurrent: overrides?.maxConcurrent,
  });
  const teardownCalls: TeardownArgs[] = [];
  const teardown = overrides?.noTeardown
    ? undefined
    : async (args: TeardownArgs): Promise<TeardownResult> => {
        teardownCalls.push(args);
        return { vercel: "deleted", neon: "skipped" };
      };
  const app = createBuilderApp({ token: TOKEN, runner, teardown });
  return { app, runner, teardownCalls };
};

const authed = (body: unknown): Request =>
  new Request("http://b/builds", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("builder service", () => {
  test("rejects an unauthenticated build", async () => {
    const { app } = makeApp();
    const res = await app.request("http://b/builds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec, buildId: "b1", appId: "app_1" }),
    });
    expect(res.status).toBe(401);
  });

  test("health is public", async () => {
    const { app } = makeApp();
    const res = await app.request("http://b/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test("accepts a build, deploys, and exposes the entryUrl on completion", async () => {
    const { app, runner } = makeApp();
    const res = await app.request(authed({ spec, buildId: "b1", appId: "app_1" }));
    expect(res.status).toBe(202);

    await runner.wait("b1");
    const status = await app.request("http://b/builds/b1", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = (await status.json()) as {
      status: string;
      result?: { entryUrl: string; vercelProject: string };
    };
    expect(body.status).toBe("done");
    expect(body.result?.entryUrl).toBe("https://superjam-app-1.vercel.app");
    expect(body.result?.vercelProject).toBe("superjam-app-1");
  });

  test("provisions Neon for a data app", async () => {
    const { app, runner } = makeApp();
    await app.request(authed({ spec: dataSpec, buildId: "b2", appId: "app_2" }));
    await runner.wait("b2");
    const status = await app.request("http://b/builds/b2", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = (await status.json()) as { result?: { neonProjectId?: string } };
    expect(body.result?.neonProjectId).toBe("neon_1");
  });

  test("surfaces a build failure as status=failed", async () => {
    const { app, runner } = makeApp({
      generate: async () => {
        throw new Error("generation blew up");
      },
    });
    await app.request(authed({ spec, buildId: "b3", appId: "app_3" }));
    await runner.wait("b3");
    const status = await app.request("http://b/builds/b3", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = (await status.json()) as { status: string; error?: string };
    expect(body.status).toBe("failed");
    expect(body.error).toContain("generation blew up");
  });

  test("returns 429 when at capacity", async () => {
    // a generator that never resolves keeps the slot occupied
    const { app } = makeApp({
      generate: () => new Promise<GeneratedApp>(() => {}),
      maxConcurrent: 1,
    });
    const first = await app.request(authed({ spec, buildId: "b4", appId: "app_4" }));
    expect(first.status).toBe(202);
    const second = await app.request(authed({ spec, buildId: "b5", appId: "app_5" }));
    expect(second.status).toBe(429);
  });

  test("404 for an unknown build", async () => {
    const { app } = makeApp();
    const res = await app.request("http://b/builds/nope", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  test("generateApp emits framed Next files + a valid manifest", () => {
    const g = generateApp(dataSpec);
    expect(g.needsData).toBe(true);
    expect(g.files["next.config.ts"]).toContain("frame-ancestors https://superjam.fun");
    expect(g.files["lib/schema.ts"]).toContain('pgTable("posts"');
    expect(g.manifest.slug).toBe("wall");
  });

  test("generated app is a self-contained, buildable Next app", () => {
    const g = generateApp(spec); // zero-backend
    // tsconfig: self-contained (no monorepo extends)
    expect(g.files["tsconfig.json"]).toBeDefined();
    expect(g.files["tsconfig.json"]).not.toContain("extends");
    // package.json: real pinned versions only — NO catalog:/workspace:; the SDK
    // comes from the PUBLISHED npm package, aliased to the @superjam/sdk path.
    const pkg = JSON.parse(g.files["package.json"]!) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@superjam/sdk"]).toBe("npm:superjam-sdk@^0.0.1");
    expect(pkg.devDependencies.typescript).toMatch(/^\^?\d/);
    const allVersions = [
      ...Object.values(pkg.dependencies),
      ...Object.values(pkg.devDependencies),
    ];
    expect(allVersions).not.toContain("catalog:");
    expect(allVersions).not.toContain("workspace:*");
    // no vendored SDK file is emitted anymore
    expect(g.files["lib/superjam-sdk.js"]).toBeUndefined();
    // deploys never blocked by a type nit in generated code
    expect(g.files["next.config.ts"]).toContain("ignoreBuildErrors: true");
  });
});

const teardownReq = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /teardown", () => {
  test("rejects an unauthenticated teardown", async () => {
    const { app } = makeApp();
    const res = await app.request("http://b/teardown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vercelProject: "superjam-x" }),
    });
    expect(res.status).toBe(401);
  });

  test("tears down the given projects and returns the per-project result", async () => {
    const { app, teardownCalls } = makeApp();
    const res = await app.request(
      "http://b/teardown",
      teardownReq({ vercelProject: "superjam-x", neonProjectId: "neon_1" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ vercel: "deleted", neon: "skipped" });
    expect(teardownCalls).toEqual([{ vercelProject: "superjam-x", neonProjectId: "neon_1" }]);
  });

  test("400 when the body carries no project ids", async () => {
    const { app } = makeApp();
    const res = await app.request("http://b/teardown", teardownReq({}));
    expect(res.status).toBe(400);
  });

  test("501 when teardown is not configured", async () => {
    const { app } = makeApp({ noTeardown: true });
    const res = await app.request(
      "http://b/teardown",
      teardownReq({ vercelProject: "superjam-x" })
    );
    expect(res.status).toBe(501);
  });
});
