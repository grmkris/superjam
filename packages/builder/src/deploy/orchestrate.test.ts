import { describe, expect, test } from "bun:test";
import type { AppSpec } from "@superjam/shared";
import {
  projectNameFor,
  runDeploy,
  specNeedsData,
  teardownApp,
} from "./orchestrate.ts";
import type {
  DeployEvent,
  GeneratedApp,
  NeonClient,
  VercelClient,
  VercelDeployment,
  VercelEnvVar,
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
  prebuilt: true,
});

/** A Vercel stub that records calls and walks a scripted readyState sequence. */
const makeVercel = (
  states: VercelDeployment["readyState"][],
  opts: { failCreate?: boolean; failDelete?: boolean } = {}
) => {
  const calls = {
    env: [] as VercelEnvVar[][],
    deployArgs: [] as { prebuilt: boolean; fileCount: number }[],
    polls: 0,
    deleted: [] as string[],
  };
  let i = 0;
  const client: VercelClient = {
    createProject: async () => {
      if (opts.failCreate) throw new Error("vercel create boom");
      return { projectId: "prj_1" };
    },
    setEnv: async (_p, vars) => {
      calls.env.push(vars);
    },
    deploy: async (a) => {
      calls.deployArgs.push({
        prebuilt: a.prebuilt,
        fileCount: Object.keys(a.files).length,
      });
      return { deploymentId: "dpl_1", url: "x.vercel.app", readyState: "QUEUED" };
    },
    getDeployment: async () => {
      calls.polls += 1;
      const state = states[Math.min(i, states.length - 1)]!;
      i += 1;
      return { deploymentId: "dpl_1", url: "x.vercel.app", readyState: state };
    },
    productionUrl: (_p, name) => `https://${name}.vercel.app`,
    deleteProject: async (id) => {
      calls.deleted.push(id);
      if (opts.failDelete) throw new Error("vercel delete boom");
    },
  };
  return { client, calls };
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

const fastDeps = { now: () => 0, sleep: async () => {}, jwksUrl: "https://superjam.fun/.well-known/jwks.json" };

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
          collections: [{ name: "posts", doc: { t: "string" }, writtenWhen: "post" }],
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
    ).toBe(false); // counters + storage → zero-backend bridge, no Neon
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

describe("runDeploy", () => {
  test("zero-backend app: skips Neon, injects only public env, returns entryUrl", async () => {
    const { client, calls } = makeVercel(["READY"]);
    const events: DeployEvent[] = [];
    const res = await runDeploy(
      { spec: baseSpec, buildId: "b1", appId: "app_1", projectName: "superjam-app_1" },
      {
        ...fastDeps,
        generate: async () => generatedApp(false),
        vercel: client,
        neon: noNeonNeeded,
        onEvent: (e) => events.push(e),
      }
    );

    expect(res.entryUrl).toBe("https://superjam-app_1.vercel.app");
    expect(res.vercelProjectId).toBe("prj_1");
    expect(res.neonProjectId).toBeUndefined();
    expect(res.manifest.slug).toBe("tip-jar");

    // env set before deploy, only the two public vars, no DATABASE_URL
    const keys = calls.env[0]!.map((v) => v.key);
    expect(keys).toEqual(["SUPERJAM_APP_ID", "SUPERJAM_JWKS_URL"]);
    expect(calls.deployArgs[0]?.prebuilt).toBe(true);
    expect(events.map((e) => e.label)).toContain("ready");
  });

  test("data app: provisions Neon and injects an encrypted DATABASE_URL", async () => {
    const { client, calls } = makeVercel(["READY"]);
    let createdName = "";
    const neon: NeonClient = {
      createProject: async (name) => {
        createdName = name;
        return {
          projectId: "neon_1",
          pooledDsn: "postgres://pooled?sslmode=require",
          directDsn: "postgres://direct?sslmode=require",
        };
      },
      deleteProject: async () => {},
    };

    const res = await runDeploy(
      { spec: baseSpec, buildId: "b1", appId: "app_2", projectName: "superjam-app_2" },
      { ...fastDeps, generate: async () => generatedApp(true), vercel: client, neon }
    );

    expect(createdName).toBe("superjam-app_2");
    expect(res.neonProjectId).toBe("neon_1");
    const dbVar = calls.env[0]!.find((v) => v.key === "DATABASE_URL");
    expect(dbVar?.value).toBe("postgres://pooled?sslmode=require");
    expect(dbVar?.type).toBe("encrypted");
  });

  test("polls through transitional states until READY", async () => {
    const { client, calls } = makeVercel(["QUEUED", "BUILDING", "READY"]);
    await runDeploy(
      { spec: baseSpec, buildId: "b", appId: "app_3", projectName: "superjam-app_3" },
      { ...fastDeps, generate: async () => generatedApp(false), vercel: client, neon: noNeonNeeded }
    );
    expect(calls.polls).toBe(3);
  });

  test("throws when the deployment errors", async () => {
    const { client } = makeVercel(["BUILDING", "ERROR"]);
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_4", projectName: "superjam-app_4" },
        { ...fastDeps, generate: async () => generatedApp(false), vercel: client, neon: noNeonNeeded }
      )
    ).rejects.toThrow(/ERROR/);
  });

  test("throws when a data app has no Neon client", async () => {
    const { client } = makeVercel(["READY"]);
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_5", projectName: "superjam-app_5" },
        { ...fastDeps, generate: async () => generatedApp(true), vercel: client }
      )
    ).rejects.toThrow(/no Neon client/);
  });
});

describe("runDeploy — partial-failure reaper", () => {
  test("data app, Vercel create fails: reaps Neon only, rethrows original", async () => {
    const { client, calls } = makeVercel(["READY"], { failCreate: true });
    const neon = makeNeon();
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_6", projectName: "superjam-app_6" },
        { ...fastDeps, generate: async () => generatedApp(true), vercel: client, neon: neon.client }
      )
    ).rejects.toThrow(/vercel create boom/);
    expect(neon.calls.deleted).toEqual(["neon_1"]);
    expect(calls.deleted).toEqual([]); // nothing created on Vercel → nothing to reap
  });

  test("no-data app, deploy errors: reaps the Vercel project, rethrows", async () => {
    const { client, calls } = makeVercel(["BUILDING", "ERROR"]);
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_7", projectName: "superjam-app_7" },
        { ...fastDeps, generate: async () => generatedApp(false), vercel: client, neon: noNeonNeeded }
      )
    ).rejects.toThrow(/ERROR/);
    expect(calls.deleted).toEqual(["prj_1"]);
  });

  test("data app, deploy errors: reaps both projects", async () => {
    const { client, calls } = makeVercel(["ERROR"]);
    const neon = makeNeon();
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_8", projectName: "superjam-app_8" },
        { ...fastDeps, generate: async () => generatedApp(true), vercel: client, neon: neon.client }
      )
    ).rejects.toThrow(/ERROR/);
    expect(calls.deleted).toEqual(["prj_1"]);
    expect(neon.calls.deleted).toEqual(["neon_1"]);
  });

  test("a reap that itself fails still rethrows the ORIGINAL error + emits", async () => {
    const { client } = makeVercel(["ERROR"], { failDelete: true });
    const events: DeployEvent[] = [];
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_9", projectName: "superjam-app_9" },
        {
          ...fastDeps,
          generate: async () => generatedApp(false),
          vercel: client,
          neon: noNeonNeeded,
          onEvent: (e) => events.push(e),
        }
      )
    ).rejects.toThrow(/Vercel deployment ERROR/); // not "vercel delete boom"
    expect(events.some((e) => e.kind === "error" && /delete failed/.test(e.label))).toBe(true);
  });

  test("a generation failure created nothing → no reap", async () => {
    const { client, calls } = makeVercel(["READY"]);
    const neon = makeNeon();
    await expect(
      runDeploy(
        { spec: baseSpec, buildId: "b", appId: "app_10", projectName: "superjam-app_10" },
        {
          ...fastDeps,
          generate: async () => {
            throw new Error("gen boom");
          },
          vercel: client,
          neon: neon.client,
        }
      )
    ).rejects.toThrow(/gen boom/);
    expect(calls.deleted).toEqual([]);
    expect(neon.calls.deleted).toEqual([]);
  });
});

describe("teardownApp", () => {
  test("deletes both projects and reports deleted/deleted", async () => {
    const { client, calls } = makeVercel(["READY"]);
    const neon = makeNeon();
    const res = await teardownApp(
      { vercelProjectId: "prj_1", neonProjectId: "neon_1" },
      { vercel: client, neon: neon.client }
    );
    expect(res).toEqual({ vercel: "deleted", neon: "deleted" });
    expect(calls.deleted).toEqual(["prj_1"]);
    expect(neon.calls.deleted).toEqual(["neon_1"]);
  });

  test("skips a project whose id is absent", async () => {
    const { client, calls } = makeVercel(["READY"]);
    const res = await teardownApp(
      { vercelProjectId: "prj_1" },
      { vercel: client, neon: makeNeon().client }
    );
    expect(res).toEqual({ vercel: "deleted", neon: "skipped" });
    expect(calls.deleted).toEqual(["prj_1"]);
  });

  test("a failed delete is reported, not thrown", async () => {
    const { client } = makeVercel(["READY"], { failDelete: true });
    const res = await teardownApp(
      { vercelProjectId: "prj_1", neonProjectId: "neon_1" },
      { vercel: client, neon: makeNeon().client }
    );
    expect(res.vercel).toBe("failed");
    expect(res.neon).toBe("deleted");
  });
});
