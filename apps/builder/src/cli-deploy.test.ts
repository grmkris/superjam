import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cliDeploy,
  type DeployRunner,
  parseDeployOutput,
  type RunResult,
} from "./cli-deploy.ts";

const OK_JSON = JSON.stringify({
  status: "ok",
  deployment: {
    id: "dpl_abc",
    url: "https://superjam-x-hash-grmkris-projects.vercel.app",
    readyState: "READY",
  },
});

describe("parseDeployOutput", () => {
  test("reads deployment.url + id from the CLI JSON", () => {
    expect(parseDeployOutput(OK_JSON)).toEqual({
      deploymentUrl: "https://superjam-x-hash-grmkris-projects.vercel.app",
      deploymentId: "dpl_abc",
    });
  });

  test("falls back to the last *.vercel.app line for non-JSON output", () => {
    const out = "Building…\nhttps://old-abc.vercel.app\nhttps://new-xyz.vercel.app\n";
    expect(parseDeployOutput(out).deploymentUrl).toBe("https://new-xyz.vercel.app");
  });

  test("throws when no URL can be found", () => {
    expect(() => parseDeployOutput("total garbage")).toThrow(/could not parse/);
  });
});

describe("cliDeploy", () => {
  const files = { "package.json": '{"name":"x"}', "app/page.tsx": "export default()=>null" };

  test("writes the files, deploys --prod, returns the PUBLIC project alias", async () => {
    let seenArgv: string[] = [];
    let wrotePkg = "";
    const run: DeployRunner = async (argv, cwd): Promise<RunResult> => {
      seenArgv = argv;
      wrotePkg = await readFile(join(cwd, "package.json"), "utf8");
      return { code: 0, stdout: OK_JSON, stderr: "" };
    };
    const res = await cliDeploy({ files, name: "superjam-app1" }, run);
    // entryUrl is the production alias (public/framable), NOT the hashed URL
    expect(res.entryUrl).toBe("https://superjam-app1.vercel.app");
    expect(res.deploymentId).toBe("dpl_abc");
    expect(seenArgv).toEqual(["vercel", "deploy", "--yes", "--prod"]);
    expect(wrotePkg).toBe('{"name":"x"}'); // file map landed in the workspace
  });

  test("sanitizes the project name for the alias", async () => {
    const run: DeployRunner = async () => ({ code: 0, stdout: OK_JSON, stderr: "" });
    const res = await cliDeploy({ files, name: "Superjam_App---X" }, run);
    expect(res.entryUrl).toBe("https://superjam_app--x.vercel.app");
  });

  test("appends --token when given", async () => {
    let seenArgv: string[] = [];
    const run: DeployRunner = async (argv) => {
      seenArgv = argv;
      return { code: 0, stdout: OK_JSON, stderr: "" };
    };
    await cliDeploy({ files, name: "n", token: "tok_123" }, run);
    expect(seenArgv).toEqual(["vercel", "deploy", "--yes", "--prod", "--token", "tok_123"]);
  });

  test("throws on a non-zero exit, surfacing stderr", async () => {
    const run: DeployRunner = async () => ({
      code: 1,
      stdout: "",
      stderr: "Error: build failed — missing tsconfig",
    });
    await expect(cliDeploy({ files, name: "n" }, run)).rejects.toThrow(
      /vercel deploy failed.*build failed/
    );
  });
});
