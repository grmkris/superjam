import { describe, expect, test } from "bun:test";
import { createTursoClient, tursoDbNameFor } from "./turso.ts";

interface StubRes {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}

const stubFetch = (responses: StubRes[]) => {
  const calls: { url: string; method?: string; body?: string }[] = [];
  let i = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      body: init?.body as string | undefined,
    });
    const r = responses[i++] ?? { ok: true, json: {} };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json ?? {},
      text: async () => r.text ?? "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe("createTursoClient", () => {
  test("createDatabase creates a db, then mints a db-scoped token", async () => {
    const { impl, calls } = stubFetch([
      { json: { database: { Hostname: "sj-x-grmkris.turso.io", Name: "sj-x" } } },
      { json: { jwt: "tok-abc" } },
    ]);
    const client = createTursoClient({ apiToken: "k", org: "grmkris", fetchImpl: impl });
    const db = await client.createDatabase("sj-x");
    expect(db).toEqual({
      name: "sj-x",
      dbUrl: "libsql://sj-x-grmkris.turso.io",
      authToken: "tok-abc",
    });
    expect(calls[0]?.url).toBe(
      "https://api.turso.tech/v1/organizations/grmkris/databases"
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[1]?.url).toBe(
      "https://api.turso.tech/v1/organizations/grmkris/databases/sj-x/auth/tokens"
    );
  });

  test("createDatabase throws on a non-ok create", async () => {
    const { impl } = stubFetch([{ ok: false, status: 409, text: "exists" }]);
    const client = createTursoClient({ apiToken: "k", org: "o", fetchImpl: impl });
    await expect(client.createDatabase("dup")).rejects.toThrow(/Turso create failed: 409/);
  });

  test("deleteDatabase treats 404 as success (idempotent)", async () => {
    const { impl } = stubFetch([{ ok: false, status: 404 }]);
    const client = createTursoClient({ apiToken: "k", org: "o", fetchImpl: impl });
    await expect(client.deleteDatabase("gone")).resolves.toBeUndefined();
  });

  test("deleteDatabase throws on a real failure", async () => {
    const { impl } = stubFetch([{ ok: false, status: 500 }]);
    const client = createTursoClient({ apiToken: "k", org: "o", fetchImpl: impl });
    await expect(client.deleteDatabase("x")).rejects.toThrow(/Turso delete failed: 500/);
  });
});

describe("tursoDbNameFor", () => {
  test("is dns-safe, lowercased, and bounded", () => {
    expect(tursoDbNameFor("App_123")).toBe("sj-app-123");
    expect(tursoDbNameFor("a".repeat(100)).length).toBeLessThanOrEqual(58);
    expect(tursoDbNameFor("--weird..name--")).toBe("sj-weird-name");
  });
});
