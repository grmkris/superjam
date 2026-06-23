// Guards the just-bash sandbox the harness hands the build agent: it must (1) read
// the seeded skeleton, (2) edit files with coreutils that LAND ON DISK (so the
// harness's real `next build` sees them), and (3) stay CONFINED to the workspace —
// no escaping to the host filesystem, no running native binaries. These are the
// properties that let us give the agent a rich shell without host risk.
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bash, ReadWriteFs } from "just-bash";

const withWorkspace = async (
  seed: Record<string, string>,
  fn: (bash: Bash, root: string) => Promise<void>
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "sjsandbox-"));
  try {
    const bash = new Bash({ fs: new ReadWriteFs({ root }), cwd: "/", env: {} });
    for (const [path, contents] of Object.entries(seed)) {
      await bash.writeFile(`/${path}`, contents);
    }
    await fn(bash, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("harness sandbox (just-bash over ReadWriteFs)", () => {
  test("sees the seeded skeleton", async () => {
    await withWorkspace({ "app/page.tsx": "export default 1", "package.json": "{}" }, async (bash) => {
      const ls = await bash.exec("ls app");
      expect(ls.exitCode).toBe(0);
      expect(ls.stdout).toContain("page.tsx");
    });
  });

  test("edits land on the real disk for the harness to build", async () => {
    await withWorkspace({ "app/page.tsx": "old" }, async (bash, root) => {
      const w = await bash.exec("echo 'new content' > app/page.tsx");
      expect(w.exitCode).toBe(0);
      // The real on-disk file (what `next build` reads) reflects the edit.
      expect(await readFile(join(root, "app/page.tsx"), "utf8")).toContain("new content");
    });
  });

  test("coreutils (sed/grep) work for surgical edits", async () => {
    await withWorkspace({ "lib/x.ts": "const a = 1;\nconst b = 2;\n" }, async (bash, root) => {
      expect((await bash.exec("grep -c const lib/x.ts")).stdout.trim()).toBe("2");
      await bash.exec("sed -i 's/const a/const z/' lib/x.ts");
      expect(await readFile(join(root, "lib/x.ts"), "utf8")).toContain("const z");
    });
  });

  test("cannot run native binaries (npm/next/vercel)", async () => {
    await withWorkspace({ "package.json": "{}" }, async (bash) => {
      const r = await bash.exec("npx next build");
      // just-bash has no such command — non-zero exit, never actually builds.
      expect(r.exitCode).not.toBe(0);
    });
  });

  test("is confined to the workspace root (no host escape)", async () => {
    await withWorkspace({ "app/page.tsx": "x" }, async (bash) => {
      // Reading a real host file via traversal must NOT yield its contents.
      const r = await bash.exec("cat ../../../../../../etc/hostname");
      expect(r.stdout).not.toContain(".");
      // And the sandbox readFile of an escaping path must not return host data.
      await expect(bash.readFile("/../../../etc/hostname")).rejects.toThrow();
    });
  });
});
