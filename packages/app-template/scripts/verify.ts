// Seed-jam + exemplar build verifier.
// For each app file (examples/*.tsx and the skill exemplars extracted to
// scripts/.exemplars/*.tsx), copy it to src/app.tsx, then (1) tsc --noEmit and
// (2) Bun.build({ entrypoints:[src/main.tsx], target:"browser" }). Restores the
// real placeholder app.tsx afterwards. Mirrors the real builder: the agent
// overwrites src/app.tsx, the platform bundles src/main.tsx.
import { $ } from "bun";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "src/app.tsx");
const MAIN = join(ROOT, "src/main.tsx");

const placeholder = await readFile(APP, "utf8");

type Result = { name: string; ok: boolean; bytes?: number; error?: string };
const results: Result[] = [];

async function verify(name: string, source: string) {
  await writeFile(APP, source);
  try {
    // 1. typecheck (catches contract drift the bundler would silently transpile)
    const tc = await $`bunx tsc --noEmit -p ${join(ROOT, "tsconfig.json")}`.quiet().nothrow();
    if (tc.exitCode !== 0) {
      results.push({ name, ok: false, error: "tsc:\n" + tc.stdout.toString() + tc.stderr.toString() });
      return;
    }
    // 2. bundle exactly as the platform does
    const out = await Bun.build({ entrypoints: [MAIN], target: "browser", minify: true });
    if (!out.success) {
      results.push({ name, ok: false, error: out.logs.map(String).join("\n") });
      return;
    }
    let bytes = 0;
    for (const a of out.outputs) bytes += (await a.arrayBuffer()).byteLength;
    results.push({ name, ok: true, bytes });
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
  }
}

const exDir = join(ROOT, "examples");
for (const f of (await readdir(exDir)).filter((f) => f.endsWith(".tsx")).sort()) {
  await verify(`examples/${f}`, await readFile(join(exDir, f), "utf8"));
}

// Markdown exemplars: extract every ```tsx fenced block that is a full app
// (contains `export default function App`) from the skill files AND SDK.md, and
// verify each compiles — these are the codegen templates the build agent
// imitates, so they must be real against the live SDK.
const skillDir = join(ROOT, "skills");
const mdFiles: string[] = [
  ...(await readdir(skillDir)).filter((f) => f.endsWith(".md")).sort().map((f) => join(skillDir, f)),
  join(ROOT, "../sdk/SDK.md"),
];
for (const path of mdFiles) {
  const md = await readFile(path, "utf8");
  const label = path.includes("/skills/") ? `skills/${path.split("/").pop()}` : "sdk/SDK.md";
  const apps = [...md.matchAll(/```tsx\n([\s\S]*?)```/g)]
    .map((m) => m[1]!)
    .filter((b) => b.includes("export default function App") && b.includes("return")); // skip signature-only skeletons
  for (let i = 0; i < apps.length; i++) {
    await verify(apps.length > 1 ? `${label} [#${i + 1}]` : label, apps[i]!);
  }
}

// restore placeholder
await writeFile(APP, placeholder);

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`✅ ${r.name.padEnd(34)} ${(r.bytes! / 1024).toFixed(0)} KB`);
  } else {
    failed++;
    console.log(`❌ ${r.name}\n${r.error}\n`);
  }
}
console.log(`\n${results.length - failed}/${results.length} built` + (failed ? ` — ${failed} FAILED` : " — all green"));

// ── Contract validation: skill-CI fixtures + Discover seed manifest ─────────
// Cheap schema gates (the real agent build for fixtures runs on the builder).
const { AppSpecSchema } = await import("@superjam/shared/appspec");
const { SEED_JAMS } = await import("../seeds.ts");
let contractFail = 0;

const fixDir = join(skillDir, "fixtures");
for (const f of (await readdir(fixDir)).filter((f) => f.endsWith(".json")).sort()) {
  const skill = f.replace(/\.json$/, "");
  try {
    const spec = AppSpecSchema.parse(JSON.parse(await readFile(join(fixDir, f), "utf8")));
    if (!spec.skills?.includes(skill as never)) throw new Error(`fixture must list skill "${skill}" in spec.skills`);
    console.log(`✅ fixtures/${f}`);
  } catch (e) {
    contractFail++;
    console.log(`❌ fixtures/${f}\n${e instanceof Error ? e.message : String(e)}\n`);
  }
}

for (const jam of SEED_JAMS) {
  const exists = (await readdir(exDir)).includes(jam.entry.replace("examples/", ""));
  if (exists && AppSpecSchema) {
    console.log(`✅ seed ${jam.manifest.slug.padEnd(20)} (${jam.entry})`);
  } else {
    contractFail++;
    console.log(`❌ seed ${jam.manifest.slug} — missing entry ${jam.entry}`);
  }
}
// seeds.ts already AppManifestSchema.parses each manifest at import time above.
console.log(`${SEED_JAMS.length} seed jams · ${(await readdir(fixDir)).filter((f) => f.endsWith(".json")).length} fixtures` + (contractFail ? ` — ${contractFail} FAILED` : " — contracts green"));

process.exit(failed || contractFail ? 1 : 0);
