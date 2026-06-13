import { describe, expect, test } from "bun:test";
import {
  type AiRunner,
  createAiService,
  toModelMessages,
} from "./ai-service.ts";

describe("toModelMessages", () => {
  test("merges system turns into the system string", () => {
    const { system, messages } = toModelMessages({
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
    });
    expect(system).toContain("be terse");
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("json mode adds a JSON-only instruction", () => {
    const { system } = toModelMessages({
      messages: [{ role: "user", content: "x" }],
      json: true,
    });
    expect(system).toContain("VALID JSON");
  });

  test("images ride as vision parts on the last user turn", () => {
    const { messages } = toModelMessages({
      messages: [{ role: "user", content: "judge this" }],
      images: ["data:image/png;base64,AAAA"],
    });
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "judge this" },
          { type: "image", image: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
  });

  test("http image urls become URL objects the AI SDK fetches", () => {
    const { messages } = toModelMessages({
      messages: [{ role: "user", content: "x" }],
      images: ["https://cdn.example.com/a.png"],
    });
    const content = messages[0]!.content as Array<{ type: string; image?: unknown }>;
    const img = content.find((p) => p.type === "image");
    expect(img?.image).toBeInstanceOf(URL);
  });

  test("synthesizes a user turn when only system messages are given", () => {
    const { messages } = toModelMessages({
      messages: [{ role: "system", content: "do the thing" }],
    });
    expect(messages.some((m) => m.role === "user")).toBe(true);
  });
});

describe("createAiService", () => {
  const req = (content: string) =>
    ({ messages: [{ role: "user" as const, content }] });

  test("returns the model text", async () => {
    const runner: AiRunner = async () => ({ text: "hello there" });
    const svc = createAiService({ runner });
    const out = await svc.run("app_1", req("hi"));
    expect(out).toEqual({ text: "hello there" });
  });

  test("passes the mapped system + messages to the runner", async () => {
    let seen: { system?: string; messages: unknown } | null = null;
    const runner: AiRunner = async (args) => {
      seen = args;
      return { text: "ok" };
    };
    const svc = createAiService({ runner });
    await svc.run("app_1", {
      messages: [{ role: "user", content: "score it" }],
      images: ["data:image/png;base64,ZZ"],
    });
    expect(seen!.system).toContain("SuperJam");
    expect(JSON.stringify(seen!.messages)).toContain("image");
  });

  test("exact-match cache: identical request runs the model once", async () => {
    let calls = 0;
    const runner: AiRunner = async () => {
      calls += 1;
      return { text: "cached!" };
    };
    const svc = createAiService({ runner });
    const r = req("same");

    expect(svc.cached("app_1", r)).toBeUndefined();
    const a = await svc.run("app_1", r);
    const b = await svc.run("app_1", r);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
    expect(svc.cached("app_1", r)).toEqual({ text: "cached!" });
  });

  test("cache is scoped per app", async () => {
    let calls = 0;
    const runner: AiRunner = async () => {
      calls += 1;
      return { text: `r${calls}` };
    };
    const svc = createAiService({ runner });
    const r = req("p");
    await svc.run("app_1", r);
    await svc.run("app_2", r);
    expect(calls).toBe(2);
  });
});
