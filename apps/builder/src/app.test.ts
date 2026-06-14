import { describe, expect, test } from "bun:test";
import type { AppSpec } from "@superjam/shared";
import type { TeardownArgs, TeardownResult } from "@superjam/builder/deploy";
import { createBuilderApp } from "./app.ts";
import { generateApp } from "./generate.ts";
import { type BuildRunner, type BuildRunnerDeps, createBuildRunner } from "./queue.ts";

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
      {
        name: "posts",
        fields: [
          { name: "text", type: "string" },
          { name: "score", type: "number" },
        ],
        writtenWhen: "post",
      },
    ],
    counters: [],
    storage: [],
  },
};

const projectName = (appId: string): string =>
  `superjam-${appId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);

const makeApp = (overrides?: {
  runBuild?: BuildRunnerDeps["runBuild"];
  maxConcurrent?: number;
  noTeardown?: boolean;
}) => {
  let runnerRef: BuildRunner | undefined;
  // Default stub = an autonomous agent that immediately reports `done` (with a
  // neon id for a data app), exercising the report → state path.
  const defaultRunBuild: BuildRunnerDeps["runBuild"] = async ({
    spec: s,
    buildId,
    appId,
    reportToken,
  }) => {
    const proj = projectName(appId);
    await runnerRef?.report(buildId, reportToken, {
      kind: "done",
      entryUrl: `https://${proj}.vercel.app`,
      vercelProject: proj,
      ...(s.data.collections.length ? { neonProjectId: "neon_1" } : {}),
    });
  };
  const runner = createBuildRunner({
    runBuild: overrides?.runBuild ?? defaultRunBuild,
    maxConcurrent: overrides?.maxConcurrent,
  });
  runnerRef = runner;
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

const reportReq = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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

  test("accepts a build; the agent's report surfaces the entryUrl on completion", async () => {
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

  test("a data app reports the neonProjectId it provisioned", async () => {
    const { app, runner } = makeApp();
    await app.request(authed({ spec: dataSpec, buildId: "b2", appId: "app_2" }));
    await runner.wait("b2");
    const status = await app.request("http://b/builds/b2", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = (await status.json()) as { result?: { neonProjectId?: string } };
    expect(body.result?.neonProjectId).toBe("neon_1");
  });

  test("the agent process erroring surfaces as status=failed", async () => {
    const { app, runner } = makeApp({
      runBuild: async () => {
        throw new Error("agent crashed");
      },
    });
    await app.request(authed({ spec, buildId: "b3", appId: "app_3" }));
    await runner.wait("b3");
    const status = await app.request("http://b/builds/b3", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = (await status.json()) as { status: string; error?: string };
    expect(body.status).toBe("failed");
    expect(body.error).toContain("agent crashed");
  });

  test("the agent ending without a report fails the build", async () => {
    const { app, runner } = makeApp({ runBuild: async () => {} });
    await app.request(authed({ spec, buildId: "b3b", appId: "app_3b" }));
    await runner.wait("b3b");
    const body = (await (
      await app.request("http://b/builds/b3b", { headers: { authorization: `Bearer ${TOKEN}` } })
    ).json()) as { status: string; error?: string };
    expect(body.status).toBe("failed");
    expect(body.error).toContain("without reporting");
  });

  test("returns 429 when at capacity", async () => {
    // an agent that never finishes keeps the slot occupied
    const { app } = makeApp({
      runBuild: () => new Promise<void>(() => {}),
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
    expect(g.files["tsconfig.json"]).toBeDefined();
    expect(g.files["tsconfig.json"]).not.toContain("extends");
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
    expect(g.files["lib/superjam-sdk.js"]).toBeUndefined();
    expect(g.files["next.config.ts"]).toContain("ignoreBuildErrors: true");
  });
});

describe("x402 hire endpoints", () => {
  test("POST / is 501 when no Circle hire resource is configured", async () => {
    const { app } = makeApp();
    const res = await app.request("http://b/", { method: "POST" });
    expect(res.status).toBe(501);
  });

  test("POST /world is 501 when no AgentKit resource is configured", async () => {
    const { app } = makeApp();
    const res = await app.request("http://b/world", { method: "POST" });
    expect(res.status).toBe(501);
  });

  test("POST /world delegates to the AgentKit hire handler", async () => {
    const runner = createBuildRunner({ runBuild: async () => {} });
    const app = createBuilderApp({
      token: TOKEN,
      runner,
      hireWorld: async (req) => {
        expect(req.path).toBe("/world");
        return { status: 200, headers: { "x-test": "1" }, body: { ok: true, paid: false } };
      },
    });
    const res = await app.request("http://b/world", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.json()).toMatchObject({ ok: true, paid: false });
  });
});

describe("POST /builds/:id/report (agent callback)", () => {
  // a never-finishing agent keeps the build `running` so we can POST reports
  const inflight = () => makeApp({ runBuild: () => new Promise<void>(() => {}) });

  test("rejects a wrong per-build token", async () => {
    const { app, runner } = inflight();
    await app.request(authed({ spec, buildId: "r1", appId: "app_r1" }));
    const res = await app.request(
      "http://b/builds/r1/report",
      reportReq("wrong-token", { kind: "status", label: "x" })
    );
    expect(res.status).toBe(401);
    expect(runner.get("r1")?.status).toBe("running");
  });

  test("404 for an unknown build (any token)", async () => {
    const { app, runner } = inflight();
    await app.request(authed({ spec, buildId: "r2", appId: "app_r2" }));
    const token = runner.get("r2")?.reportToken ?? "";
    const res = await app.request(
      "http://b/builds/does-not-exist/report",
      reportReq(token, { kind: "status", label: "x" })
    );
    expect(res.status).toBe(404);
  });

  test("accepts status then done with the valid token", async () => {
    const { app, runner } = inflight();
    await app.request(authed({ spec, buildId: "r3", appId: "app_r3" }));
    const token = runner.get("r3")?.reportToken ?? "";

    const s = await app.request(
      "http://b/builds/r3/report",
      reportReq(token, { kind: "status", label: "halfway" })
    );
    expect(s.status).toBe(200);
    expect(runner.get("r3")?.events.at(-1)?.label).toBe("halfway");

    const d = await app.request(
      "http://b/builds/r3/report",
      reportReq(token, {
        kind: "done",
        entryUrl: "https://superjam-app-r3.vercel.app",
        vercelProject: "superjam-app-r3",
      })
    );
    expect(d.status).toBe(200);
    expect(runner.get("r3")?.status).toBe("done");
    expect(runner.get("r3")?.result?.entryUrl).toBe("https://superjam-app-r3.vercel.app");
  });

  test("400 on a malformed report body", async () => {
    const { app, runner } = inflight();
    await app.request(authed({ spec, buildId: "r4", appId: "app_r4" }));
    const token = runner.get("r4")?.reportToken ?? "";
    const res = await app.request(
      "http://b/builds/r4/report",
      reportReq(token, { kind: "nonsense" })
    );
    expect(res.status).toBe(400);
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
});
