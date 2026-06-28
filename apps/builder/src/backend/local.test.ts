import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBackend } from "./local.ts";

// Each test gets a fresh, real temp workspace (pure fs + subprocess — no DB).
const freshDir = () => mkdtemp(join(tmpdir(), "sj-backend-"));
const dirs: string[] = [];
const backend = async () => {
  const dir = await freshDir();
  dirs.push(dir);
  return new LocalBackend(dir);
};

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test("writeFiles + readFile round-trips a nested path", async () => {
  const b = await backend();
  await b.writeFiles({ "a/b.txt": "hi" });
  expect(await b.readFile("a/b.txt")).toBe("hi");
});

test("exec returns code 0 and captures stdout", async () => {
  const b = await backend();
  const r = await b.exec("echo hello");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("hello");
});

test("exec does not throw on non-zero exit — surfaces the code", async () => {
  const b = await backend();
  const r = await b.exec("exit 3");
  expect(r.code).toBe(3);
});

test("writeFiles rejects a path that escapes the workspace", async () => {
  const b = await backend();
  await expect(b.writeFiles({ "../evil": "x" })).rejects.toThrow(/escapes/);
});
