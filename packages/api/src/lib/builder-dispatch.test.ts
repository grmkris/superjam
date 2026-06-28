import { describe, expect, test } from "bun:test";
import type { DeployResult, TeardownResult } from "@superjam/builder/deploy";
import type { AppSpec } from "@superjam/shared";
import {
  createRemoteDeployer,
  createRemoteTeardowner,
  type FetchLike,
} from "./builder-dispatch.ts";

const spec = {} as AppSpec; // dispatch never inspects the spec, only forwards it

const result: DeployResult = {
  entryUrl: "https://superjam-app1.vercel.app",
  manifest: {
    name: "x",
    slug: "x",
    description: "x",
    iconEmoji: "x",
    category: "tool",
    capabilities: [],
  },
  vercelProject: "prj_1",
  durationMs: 1,
};

/** A scripted fetch: first the POST /builds, then scripted GET /builds/:id. */
const scriptedFetch = (
  accept: { status: number },
  polls: { status: string; result?: DeployResult; error?: string }[]
) => {
  let i = -1;
  const fn: FetchLike = async (input) => {
    const url = String(input);
    if (url.endsWith("/builds")) {
      return new Response("{}", { status: accept.status });
    }
    i += 1;
    return new Response(JSON.stringify(polls[Math.min(i, polls.length - 1)]), {
      status: 200,
    });
  };
  return fn;
};

const base = { url: "http://builder", token: "t", sleep: async () => {} };

describe("createRemoteDeployer", () => {
  test("dispatches, polls past running, returns the deploy result", async () => {
    const deploy = createRemoteDeployer({
      ...base,
      fetchImpl: scriptedFetch({ status: 202 }, [
        { status: "running" },
        { status: "done", result },
      ]),
    });
    const out = await deploy({ spec, buildId: "b1", appId: "app_1" });
    expect(out.entryUrl).toBe("https://superjam-app1.vercel.app");
  });

  test("429 surfaces as BUILDER_BUSY so the platform retries", async () => {
    const deploy = createRemoteDeployer({
      ...base,
      fetchImpl: scriptedFetch({ status: 429 }, []),
    });
    await expect(deploy({ spec, buildId: "b", appId: "a" })).rejects.toThrow(
      /BUILDER_BUSY/
    );
  });

  test("a failed build rejects with the builder's error", async () => {
    const deploy = createRemoteDeployer({
      ...base,
      fetchImpl: scriptedFetch({ status: 202 }, [
        { status: "failed", error: "vercel exploded" },
      ]),
    });
    await expect(deploy({ spec, buildId: "b", appId: "a" })).rejects.toThrow(
      /vercel exploded/
    );
  });
});

describe("createRemoteTeardowner", () => {
  test("POSTs /teardown and returns the per-project result", async () => {
    const teardownResult: TeardownResult = { vercel: "deleted", neon: "skipped" };
    let sentBody: unknown;
    const fetchImpl: FetchLike = async (input, init) => {
      expect(String(input)).toBe("http://builder/teardown");
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(teardownResult), { status: 200 });
    };
    const teardown = createRemoteTeardowner({ url: "http://builder", token: "t", fetchImpl });
    const out = await teardown({ vercelProject: "prj_1" });
    expect(out).toEqual(teardownResult);
    expect(sentBody).toEqual({ vercelProject: "prj_1" });
  });

  test("a non-2xx response rejects", async () => {
    const fetchImpl: FetchLike = async () => new Response("nope", { status: 500 });
    const teardown = createRemoteTeardowner({ url: "http://builder", token: "t", fetchImpl });
    await expect(teardown({ neonProjectId: "neon_1" })).rejects.toThrow(/teardown failed: 500/);
  });
});
