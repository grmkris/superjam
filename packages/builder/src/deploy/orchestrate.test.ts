import { describe, expect, test } from "bun:test";
import type { AppSpec } from "@superjam/shared";
import {
  projectNameFor,
  runDeploy,
  sanitizeProjectName,
  specNeedsData,
  teardownApp,
} from "./orchestrate.ts";
import type {
  DeployEvent,
  DeployPort,
  GeneratedApp,
  NeonClient,
  VercelTeardown,
} from "./types.ts";

const baseSpec: AppSpec = {
  name: "Tip Jar",
  slug: "tip-jar",
  description: "tips",
  iconEmoji: "💸",
  category: "tool",
  capabilities: ["payments"],
  features: ["tip"],
  data: { collections: [], counters: [], storage: [] },
  ui: { layout: "x", sections: ["a"] },
  acceptance: ["ok"],
};

const manifest = {
  name: "Tip Jar",
  slug: "tip-jar",
  description: "tips",
  iconEmoji: "💸",
  category: "tool" as const,
  capabilities: ["payments" as const],
};

const generatedApp = (needsData: boolean): GeneratedApp => ({
  files: { "package.json": "{}", "app/page.tsx": "export default () => null" },
  manifest,
  needsData,
  prebuilt: false,
});

/** A deploy-port stub: records the file map + name, returns the project alias. */
const makeDeploy = (opts: { fail?: string } = {}) => {
  const deployed: { name: string; fileCount: number }[] = [];
  const deploy: DeployPort = async ({ files, name }) => {
    if (opts.fail) throw new Error(opts.fail);
    deployed.push({ name, fileCount: Object.keys(files).length });
    return { entryUrl: `https://${name}.vercel.app`, deploymentId: "dpl_1" };
  };
  return { deploy, deployed };
};

/** A `vercel rm` spy. */
const makeTeardownVercel = (opts: { fail?: boolean } = {}) => {
  const reaped: string[] = [];
  const teardownVercel: VercelTeardown = async (name) => {
    reaped.push(name);
    if (opts.fail) throw new Error("vercel rm boom");
  };
  return { teardownVercel, reaped };
};

/** A Neon stub that records created + deleted project ids. */
const makeNeon = () => {
  const calls = { created: 0, deleted: [] as string[] };
  const client: NeonClient = {
    createProject: async () => {
      calls.created += 1;
      return {
        projectId: "neon_1",
        pooledDsn: "postgres://pooled?sslmode=require",
        directDsn: "postgres://direct?sslmode=require",
      };
    },
    deleteProject: async (id) => {
      calls.deleted.push(id);
    },
  };
  return { client, calls };
};

const noNeonNeeded: NeonClient = {
  createProject: async () => {
    throw new Error("should not provision Neon");
  },
  deleteProject: async () => {},
};

const fastDeps = {
  now: () => 0,
  jwksUrl: "https://superjam.fun/.well-known/jwks.json",
};

describe("specNeedsData", () => {
  test("false for a zero-backend app", () => {
    expect(specNeedsData(baseSpec)).toBe(false);
  });
  test("true only when collections are declared (its own Neon schema)", () => {
    expect(
      specNeedsData({
        ...baseSpec,
        data: {
          ...baseSpec.data,
          collections: [{ name: "posts", fields: [{ name: "t", type: "string" }], writtenWhen: "post" }],
        },
      })
    ).toBe(true);
  });
  test("false for a counter/storage-only app (zero-backend bridge tier)", () => {
    expect(
      specNeedsData({
        ...baseSpec,
        data: {
          collections: [],
          counters: [{ name: "c", keyedBy: "k", meaning: "m" }],
          storage: [{ key: "s", meaning: "m" }],
        },
      })
    ).toBe(false);
  });
});

describe("projectNameFor", () => {
  test("is dns-safe and bounded", () => {
    const n = projectNameFor("app_ABC123");
    expect(n).toBe("superjam-app-abc123");
    expect(n.length).toBeLessThanOrEqual(100);
    expect(n).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("sanitizeProjectName", () => {
  test("maps _/. to -, collapses runs, trims boundaries, lowercases", () => {
    expect(sanitizeProjectName("Superjam-App_1")).toBe("superjam-app-1"); // _ → -
    expect(sanitizeProjectName("superjam---app")).toBe("superjam--app"); // 3+ → 2
    expect(sanitizeProjectName("-x.y-")).toBe("x-y"); // . → -, boundary trim
    expect(sanitizeProjectName("")).toBe("superjam-app"); // empty fallback
  });
});

describe("runDeploy", () => {
  test("zero-backend app: skips Neon, deploys the files, returns entryUrl", async () => {
    const { deploy, deployed } = makeDeploy();
    const events: DeployEvent[] = [];
    const res = await runDeploy(
      { spec: baseSpec, buildId: "b1", appId: "app_1", projectName: "superjam-app-1" },
      { ...fastDeps, generate: async () => generatedApp(false), deploy, neon: noNeonNeeded, onEvent: (e) => events.push(e) }
    );

    expect(res.entryUrl).toBe("https://superjam-app-1.vercel.app");
    expect(res.vercelProject).toBe("superjam-app-1");
    expect(res.neonProjectId).toBeUndefined();
    expect(res.manifest.slug).toBe("tip-jar");
    // the generated file map reached the deploy port under the project name
    expect(deployed).toEqual([{ name: "superjam-app-1", fileCount: 2 }]);
    expect(events.map((e) => e.label)).toContain("ready");
  });

  test("data app: provisions Neon, returns neonProjectId", async () => {
    const { deploy } = makeDeploy();
    const neon = makeNeon();
    const res = await runDeploy(
      { spec: baseSpec, buildId: "b1", appId: "app_2", projectName: "superjam-app-2" },
      { ...fastDeps, generate: async () => generatedApp(true), deploy, neon: neon.client }
    );
    expect(neon.calls.created).toBe(1);
    expect(res.neonProjectId).toBe("neon_1");
  });

  test("throws when a data app has no Neon client", async () => {
    const { deploy } = makeDeploy();
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_5", projectName: "superjam-app-5" },
        { ...fastDeps, generate: async () => generatedApp(true), deploy }
      )
    ).rejects.toThrow(/no Neon client/);
  });
});

describe("runDeploy — partial-failure reaper", () => {
  test("no-data app, deploy fails: reaps the Vercel project, rethrows", async () => {
    const { deploy } = makeDeploy({ fail: "vercel build boom" });
    const tv = makeTeardownVercel();
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_7", projectName: "superjam-app-7" },
        { ...fastDeps, generate: async () => generatedApp(false), deploy, teardownVercel: tv.teardownVercel, neon: noNeonNeeded }
      )
    ).rejects.toThrow(/vercel build boom/);
    expect(tv.reaped).toEqual(["superjam-app-7"]);
  });

  test("data app, deploy fails: reaps the Vercel project AND the Neon project", async () => {
    const { deploy } = makeDeploy({ fail: "boom" });
    const tv = makeTeardownVercel();
    const neon = makeNeon();
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_8", projectName: "superjam-app-8" },
        { ...fastDeps, generate: async () => generatedApp(true), deploy, teardownVercel: tv.teardownVercel, neon: neon.client }
      )
    ).rejects.toThrow(/boom/);
    expect(tv.reaped).toEqual(["superjam-app-8"]);
    expect(neon.calls.deleted).toEqual(["neon_1"]);
  });

  test("a reap that itself fails still rethrows the ORIGINAL error + emits", async () => {
    const { deploy } = makeDeploy({ fail: "deploy failed: real cause" });
    const tv = makeTeardownVercel({ fail: true });
    const events: DeployEvent[] = [];
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_9", projectName: "superjam-app-9" },
        { ...fastDeps, generate: async () => generatedApp(false), deploy, teardownVercel: tv.teardownVercel, neon: noNeonNeeded, onEvent: (e) => events.push(e) }
      )
    ).rejects.toThrow(/real cause/); // not "vercel rm boom"
    expect(events.some((e) => e.kind === "error" && /delete failed/.test(e.label))).toBe(true);
  });

  test("a generation failure created nothing → no reap", async () => {
    const { deploy } = makeDeploy();
    const tv = makeTeardownVercel();
    const neon = makeNeon();
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_10", projectName: "superjam-app-10" },
        {
          ...fastDeps,
          generate: async () => {
            throw new Error("gen boom");
          },
          deploy,
          teardownVercel: tv.teardownVercel,
          neon: neon.client,
        }
      )
    ).rejects.toThrow(/gen boom/);
    expect(tv.reaped).toEqual([]);
    expect(neon.calls.deleted).toEqual([]);
  });
});

describe("teardownApp", () => {
  test("removes both projects and reports deleted/deleted", async () => {
    const tv = makeTeardownVercel();
    const neon = makeNeon();
    const res = await teardownApp(
      { vercelProject: "superjam-x", neonProjectId: "neon_1" },
      { teardownVercel: tv.teardownVercel, neon: neon.client }
    );
    expect(res).toEqual({ vercel: "deleted", neon: "deleted" });
    expect(tv.reaped).toEqual(["superjam-x"]);
    expect(neon.calls.deleted).toEqual(["neon_1"]);
  });

  test("skips a project whose id is absent", async () => {
    const tv = makeTeardownVercel();
    const res = await teardownApp(
      { vercelProject: "superjam-x" },
      { teardownVercel: tv.teardownVercel, neon: makeNeon().client }
    );
    expect(res).toEqual({ vercel: "deleted", neon: "skipped" });
  });

  test("a failed delete is reported, not thrown", async () => {
    const tv = makeTeardownVercel({ fail: true });
    const res = await teardownApp(
      { vercelProject: "superjam-x", neonProjectId: "neon_1" },
      { teardownVercel: tv.teardownVercel, neon: makeNeon().client }
    );
    expect(res.vercel).toBe("failed");
    expect(res.neon).toBe("deleted");
  });
});
