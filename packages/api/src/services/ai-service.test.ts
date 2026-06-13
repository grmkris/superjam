import { describe, expect, test } from "bun:test";
import {
  type AiRunner,
  buildAnswer,
  createAiService,
} from "./ai-service.ts";

describe("buildAnswer", () => {
  test("text mode asks for no schema", () => {
    const { schema } = buildAnswer({ mode: "text", prompt: "hi" });
    expect(schema).toBeUndefined();
  });
  test("json mode steers with the shape hint", () => {
    const { system, schema } = buildAnswer({
      mode: "json",
      prompt: "x",
      shapeHint: "{ score: number }",
    });
    expect(schema).toBeDefined();
    expect(system).toContain("{ score: number }");
  });
  test("tools mode lists the declared functions", () => {
    const { system } = buildAnswer({
      mode: "tools",
      prompt: "x",
      tools: [{ name: "spin", description: "spin it", params: { times: "number" } }],
    });
    expect(system).toContain("spin: spin it");
  });
});

describe("createAiService", () => {
  test("text mode returns the model text", async () => {
    const runner: AiRunner = async () => ({ text: "hello there" });
    const svc = createAiService({ runner });
    const out = await svc.run("app_1", { mode: "text", prompt: "hi" });
    expect(out).toEqual({ text: "hello there" });
  });

  test("json mode unwraps a stringified payload", async () => {
    const runner: AiRunner = async () => ({ object: { json: '{"a":1}' } });
    const svc = createAiService({ runner });
    const out = await svc.run("app_1", { mode: "json", prompt: "x" });
    expect(out).toEqual({ json: { a: 1 } });
  });

  test("tools mode normalizes toolCalls and keeps text", async () => {
    const runner: AiRunner = async () => ({
      object: { text: "spinning", toolCalls: [{ name: "spin", args: { times: 3 } }] },
    });
    const svc = createAiService({ runner });
    const out = await svc.run("app_1", {
      mode: "tools",
      prompt: "spin 3x",
      tools: [{ name: "spin", description: "d", params: { times: "number" } }],
    });
    expect(out).toEqual({ text: "spinning", toolCalls: [{ name: "spin", args: { times: 3 } }] });
  });

  test("rejects a tool call with a wrong-typed arg", async () => {
    const runner: AiRunner = async () => ({
      object: { toolCalls: [{ name: "spin", args: { times: "lots" } }] },
    });
    const svc = createAiService({ runner });
    await expect(
      svc.run("app_1", {
        mode: "tools",
        prompt: "x",
        tools: [{ name: "spin", description: "d", params: { times: "number" } }],
      })
    ).rejects.toThrow(/must be number/);
  });

  test("exact-match cache: identical request runs the model once", async () => {
    let calls = 0;
    const runner: AiRunner = async () => {
      calls += 1;
      return { text: "cached!" };
    };
    const svc = createAiService({ runner });
    const req = { mode: "text" as const, prompt: "same" };

    expect(svc.cached("app_1", req)).toBeUndefined();
    const a = await svc.run("app_1", req);
    const b = await svc.run("app_1", req);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
    expect(svc.cached("app_1", req)).toEqual({ text: "cached!" });
  });

  test("cache is scoped per app", async () => {
    let calls = 0;
    const runner: AiRunner = async () => {
      calls += 1;
      return { text: `r${calls}` };
    };
    const svc = createAiService({ runner });
    const req = { mode: "text" as const, prompt: "p" };
    await svc.run("app_1", req);
    await svc.run("app_2", req);
    expect(calls).toBe(2);
  });
});
