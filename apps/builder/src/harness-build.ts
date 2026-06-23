// harness-build — the AI-SDK build driver (BUILD_DRIVER=harness). The alternative
// to the free-roaming Claude Agent SDK path (agent-build.ts): a tight, inspectable
// loop built on the Vercel AI SDK's `generateText` tool loop. The model edits the
// seeded skeleton through write_file / read_file + a SANDBOXED `bash` (just-bash:
// built-in coreutils only, no host shell, no host env, no native binaries — scoped
// to the workspace via a ReadWriteFs). The harness — not the model — owns the
// control flow AND the real toolchain: it runs the AUTHORITATIVE `npm install` +
// `next build` on the host, loops the error back until green, then DETERMINISTICALLY
// deploys. So a build is "agent edits (sandboxed) → harness builds → (green?) deploy",
// with the model only responsible for making the code compile against the spec.
//
// Reporting reuses the SAME loopback /report protocol the agent path uses (so
// queue.ts/app.ts are untouched) — but over `fetch`, not a shelled-out curl, since
// this driver runs in-process.
import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import exifr from "exifr";
import { Bash, ReadWriteFs } from "just-bash";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { specNeedsData, type NeonClient } from "@superjam/builder/deploy";
import type { AppSpec } from "@superjam/shared";
import { generateImage, generateVoice } from "./assets.ts";
import type { BackendFactory } from "./backend/index.ts";
import {
  IMAGE_BUDGET,
  VOICE_BUDGET,
  buildSystemPrompt,
  buildTaskPrompt,
  type DriverSeams,
} from "./build-prompt.ts";
import { parseDeployOutput, vercelProjectName } from "./cli-deploy.ts";
import { generateApp } from "./generate.ts";
import { genericGate, selectKit } from "./kits/index.ts";

// Tool steps the model gets PER build round (one round = one `generateText` call
// followed by the harness's authoritative `next build`).
const STEPS_PER_ROUND = 30;
// How many times we feed a failed build back before giving up.
const MAX_BUILD_ROUNDS = 4;
// `next build` can be slow for rich apps; deploy uploads + remote-builds.
const BUILD_TIMEOUT_MS = 8 * 60 * 1000;
const DEPLOY_TIMEOUT_MS = 12 * 60 * 1000;

const workspaceRoot = (): string =>
  process.env.BUILD_WORKSPACE_ROOT ?? join(homedir(), "superjam-builds");

/** Keep tool/build output small in the model's context — only the tail matters. */
const tail = (s: string, n = 4000): string => (s.length > n ? s.slice(-n) : s);

export interface HarnessBuildArgs {
  spec: AppSpec;
  buildId: string;
  /** Pre-generated app id (JWT aud), baked into the skeleton + the project name. */
  appId: string;
  /** Per-build secret used to authenticate the loopback /report calls. */
  reportToken: string;
  /** The builder's own listen port — we report to the loopback callback. */
  port: number;
  /** Platform JWKS baked into the app's source (identity). */
  jwksUrl: string;
  /** Presigned GET URLs for user-attached reference files (§17). */
  attachmentUrls?: string[];
}

export interface HarnessBuildDeps {
  /** Build-execution substrate factory (local host / sandbox), per BUILD_BACKEND. */
  backendFactory: BackendFactory;
  /** The coding model (any AI-SDK provider) — built in the composition root so the
   *  harness is provider-agnostic (Gemini via @ai-sdk/google, Claude, …). */
  model: LanguageModel;
  /** Vercel operator token; omit to use the box's logged-in CLI session. */
  vercelToken?: string;
  /** Neon client for data apps; absent ⇒ data apps fail fast. */
  neon?: NeonClient;
  /** Google key for the build-time asset tools; absent ⇒ they degrade to emoji/CSS. */
  googleKey?: string;
  /** Skip the real `vercel deploy` after a green build (safe local trials). */
  dryRun?: boolean;
}

// The model's deploy/report seams for the shared system preamble. Unlike the agent
// path, the harness OWNS the toolchain + deploy + reporting — the model only EDITS
// files in a sandbox; it cannot run npm/next/vercel. So the seam tells it the build
// is run FOR it between rounds, and redirects it away from real commands entirely.
const HARNESS_SEAMS: DriverSeams = {
  toolsIntro: "(bash, write_file, and read_file)",
  deploy: `## Your goal: code that compiles — the harness builds & deploys for you
Edit files with write_file (whole files) and the bash tool (a SANDBOXED shell — ls, cat, sed, grep, find, etc., scoped to the app workspace). You CANNOT run \`npm\`, \`next\`, \`vercel\`, or any other real binary — bash only has built-in coreutils, and the harness runs the real toolchain for you. When you stop editing, the harness runs \`next build\`; if it fails you get the errors back to fix, and once it's green the harness deploys automatically. Do not try to install packages, build, or deploy yourself.`,
  // No reporting seam: the harness streams progress to /report, not the model.
};

/** Loopback /report client — same protocol as the agent path, over fetch. */
const reporter = (port: number, buildId: string, token: string) => {
  const url = `http://127.0.0.1:${port}/builds/${buildId}/report`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const post = (body: unknown): Promise<unknown> =>
    fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(
      () => undefined
    );
  return {
    status: (label: string) => post({ kind: "status", label }),
    done: (r: {
      entryUrl: string;
      vercelProject: string;
      neonProjectId?: string;
      contractAddress?: string;
      contractAbi?: readonly unknown[];
    }) => post({ kind: "done", ...r }),
    failed: (error: string) => post({ kind: "failed", error }),
  };
};

/** Normalize an agent-supplied path to an absolute path inside the sandbox FS. */
const fsPath = (p: string): string => (p.startsWith("/") ? p : `/${p}`);

interface PhotoMeta {
  /** Path under public/ (web-served), e.g. "uploads/0.jpg". */
  file: string;
  lat: number | null;
  lng: number | null;
  takenAt: number | null;
}

/**
 * BUILD-TIME media ingestion. The maker's uploads arrive as presigned URLs; the
 * sandboxed agent has NO network, so the HARNESS (real host) downloads them into
 * public/uploads/ (shipped + web-served by the deployed app) and extracts EXIF
 * GPS/timestamp from images into public/photos.json — the contract media kits
 * (photo-album) consume. Returns the image count so selectKit can route to a media
 * kit. (LocalBackend.workdir is real disk; a future sandbox backend needs a binary
 * write seam.) Best-effort: a failed download/EXIF is skipped, never fatal.
 */
const ingestMedia = async (
  ws: string,
  urls: string[] | undefined,
  onStep: (label: string) => void
): Promise<{ imageCount: number }> => {
  if (!urls?.length) return { imageCount: 0 };
  await mkdir(join(ws, "public", "uploads"), { recursive: true });
  const photos: PhotoMeta[] = [];
  let imageCount = 0;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i]!);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = ct.includes("png")
        ? "png"
        : ct.includes("webp")
          ? "webp"
          : ct.includes("gif")
            ? "gif"
            : ct.includes("jpeg") || ct.includes("jpg")
              ? "jpg"
              : ct.includes("pdf")
                ? "pdf"
                : ct.includes("csv")
                  ? "csv"
                  : "bin";
      const rel = `uploads/${i}.${ext}`;
      await writeFile(join(ws, "public", rel), bytes);
      if (ct.startsWith("image/")) {
        imageCount += 1;
        let lat: number | null = null;
        let lng: number | null = null;
        let takenAt: number | null = null;
        try {
          const gps = await exifr.gps(bytes);
          if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
            lat = gps.latitude;
            lng = gps.longitude;
          }
        } catch {
          /* not all photos carry GPS */
        }
        try {
          const meta = (await exifr.parse(bytes, ["DateTimeOriginal"])) as
            | { DateTimeOriginal?: Date }
            | undefined;
          if (meta?.DateTimeOriginal) takenAt = +new Date(meta.DateTimeOriginal);
        } catch {
          /* no timestamp */
        }
        photos.push({ file: rel, lat, lng, takenAt });
      }
    } catch {
      /* skip a failed download */
    }
  }
  if (photos.length) {
    await writeFile(join(ws, "public", "photos.json"), JSON.stringify(photos, null, 2));
  }
  onStep(`prepared ${urls.length} upload(s) (${imageCount} photo(s))`);
  return { imageCount };
};

/**
 * The model's toolset. The agent edits inside a SANDBOXED just-bash shell (`bash`)
 * + structured write_file/read_file — all bound to the same in-process FS, which is
 * a ReadWriteFs rooted at the real workspace (so edits land on disk for the harness
 * to build, but the agent has NO host shell, NO host env, and CANNOT run npm/next/
 * vercel or any native binary). generate_image/generate_voice bake fixed art/audio
 * into public/. `onStep` surfaces a human progress label.
 *
 * NOTE: the asset tools write BINARY straight to disk under workdir (== the sandbox
 * root), since just-bash's writeFile is utf-8 only.
 */
const buildTools = (
  sandbox: Bash,
  workdir: string,
  googleKey: string | undefined,
  onStep: (label: string) => void
) => {
  let images = 0;
  let voices = 0;
  const writeBinary = async (rel: string, bytes: Uint8Array): Promise<string> => {
    const clean = rel.replace(/^\/+/, "");
    const p = clean.startsWith("public/") ? clean : join("public", clean);
    const abs = resolve(workdir, p);
    if (!abs.startsWith(resolve(workdir))) throw new Error("path escapes workspace");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return p;
  };
  return {
    write_file: tool({
      description:
        "Create or overwrite a file in the app workspace (path relative to the app root, e.g. app/page.tsx).",
      inputSchema: z.object({ path: z.string().min(1), contents: z.string() }),
      execute: async ({ path, contents }) => {
        await sandbox.writeFile(fsPath(path), contents);
        onStep(`editing ${path}`);
        return `wrote ${path}`;
      },
    }),
    read_file: tool({
      description: "Read a file from the app workspace (utf-8).",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async ({ path }) => {
        try {
          return tail(await sandbox.readFile(fsPath(path)), 8000);
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
    bash: tool({
      description:
        "Run a command in a SANDBOXED shell scoped to the app workspace: built-in coreutils only (ls, cat, sed, grep, find, mkdir, mv, cp, jq, …). Use it to inspect and edit files. It CANNOT run npm, next, vercel, or any other real binary — the harness builds & deploys for you.",
      inputSchema: z.object({ cmd: z.string().min(1) }),
      execute: async ({ cmd }) => {
        onStep(cmd.length > 64 ? `${cmd.slice(0, 64)}…` : cmd);
        const r = await sandbox.exec(cmd);
        return `exit ${r.exitCode}\n--- stdout ---\n${tail(r.stdout)}\n--- stderr ---\n${tail(r.stderr)}`;
      },
    }),
    generate_image: tool({
      description:
        'Generate a PNG into public/ for FIXED art (sprite/background/logo), referenced as <img src="/<path>">. Not for per-user images.',
      inputSchema: z.object({ prompt: z.string().min(1), path: z.string().min(1) }),
      execute: async ({ prompt, path }) => {
        if (!googleKey) return "image generation unavailable — use an emoji or a CSS gradient";
        if (images >= IMAGE_BUDGET) return `image budget (${IMAGE_BUDGET}) exhausted — reuse an asset or use emoji/CSS`;
        try {
          const rel = await writeBinary(path, await generateImage(prompt, googleKey));
          images += 1;
          onStep("generating art");
          return `wrote ${rel} (reference it at /${rel.replace(/^public\//, "")})`;
        } catch (e) {
          return `image generation failed (${e instanceof Error ? e.message : String(e)}) — fall back to emoji/CSS`;
        }
      },
    }),
    generate_voice: tool({
      description:
        "Synthesize a WAV into public/ for FIXED narration/jingles (not per-user speech). Play via an <audio> element.",
      inputSchema: z.object({
        text: z.string().min(1).max(2000),
        path: z.string().min(1),
        voice: z.string().optional(),
      }),
      execute: async ({ text, path, voice }) => {
        if (!googleKey) return "voice generation unavailable — use procedural WebAudio SFX";
        if (voices >= VOICE_BUDGET) return `voice budget (${VOICE_BUDGET}) exhausted`;
        try {
          const rel = await writeBinary(path, await generateVoice(text, googleKey, voice));
          voices += 1;
          onStep("generating audio");
          return `wrote ${rel} (reference it at /${rel.replace(/^public\//, "")})`;
        } catch (e) {
          return `voice generation failed (${e instanceof Error ? e.message : String(e)}) — fall back to SFX`;
        }
      },
    }),
  };
};

/**
 * Run one build to completion via the AI-SDK harness. Seeds the skeleton, lets the
 * model implement it, loops the authoritative `next build` until green, then deploys
 * and reports the result via /report. Resolves when terminal (done/failed reported);
 * any thrown error is reported as `failed` (queue.ts also backstops a silent exit).
 */
export const runHarnessBuild = async (
  args: HarnessBuildArgs,
  deps: HarnessBuildDeps
): Promise<void> => {
  const report = reporter(args.port, args.buildId, args.reportToken);
  // Stable workspace dir == the Vercel project name, so `vercel deploy` derives
  // that project (a redeploy updates the same project instead of orphaning a new
  // one — Vercel names a project after the deployed directory's basename).
  const project = vercelProjectName(`superjam-${args.appId}`);
  const root = workspaceRoot();
  await mkdir(root, { recursive: true });
  const ws = join(root, project);
  const backend = deps.backendFactory(ws);

  try {
    await report.status("setting up the workspace");

    // BUILD-TIME media: download the maker's uploads (the sandboxed agent can't) +
    // bake EXIF → public/photos.json. imageCount routes specs with photos to a media kit.
    const { imageCount } = await ingestMedia(ws, args.attachmentUrls, (s) => void report.status(s));

    // A matched use-case kit overlays a near-complete starter (working app/page.tsx
    // with `// TODO:` gaps) onto the generic skeleton — so a cheap model FILLS gaps
    // instead of authoring (and coasting). No match ⇒ the generic skeleton + gate.
    const kit = selectKit(args.spec, { imageCount });
    // A kit can REQUIRE skills (e.g. "map") — merge them into the spec so generateApp
    // seeds the per-skill scaffolding (the <TripMap> component) the kit's starter imports.
    const genSpec = kit?.skills?.length
      ? { ...args.spec, skills: [...new Set([...(args.spec.skills ?? []), ...kit.skills])] }
      : args.spec;
    const base = generateApp(genSpec, {
      buildId: args.buildId,
      appId: args.appId,
      jwksUrl: args.jwksUrl,
    });
    const seedFiles = kit
      ? {
          ...base.files,
          ...kit.starterFiles(args.spec, {
            appId: args.appId,
            buildId: args.buildId,
            jwksUrl: args.jwksUrl,
          }),
        }
      : base.files;
    await backend.writeFiles(seedFiles);
    const seedPage = seedFiles["app/page.tsx"] ?? "";

    // Data app → provision its own Neon DB; the pooled DSN feeds build + deploy env.
    let dsn: string | undefined;
    let neonProjectId: string | undefined;
    if (specNeedsData(args.spec)) {
      if (!deps.neon) {
        await report.failed("this jam needs a database but the builder has no Neon key configured");
        return;
      }
      await report.status("provisioning the database");
      const p = await deps.neon.createProject(project);
      dsn = p.pooledDsn;
      neonProjectId = p.projectId;
    }
    const buildEnv = dsn ? { DATABASE_URL: dsn } : undefined;

    // The agent's editing sandbox: a just-bash shell over a ReadWriteFs rooted at the
    // real workspace. Edits land on disk (so the harness can build them) but the agent
    // gets NO host shell, NO host env (empty), and can't run any native binary — it
    // can only manipulate files with built-in coreutils. The harness owns the toolchain.
    const sandbox = new Bash({ fs: new ReadWriteFs({ root: ws }), cwd: "/", env: {} });

    const model = deps.model;
    const system = await buildSystemPrompt(args.spec, HARNESS_SEAMS);
    // A kit ships a FILLED, ordered checklist; a starter app/page.tsx already exists,
    // so the model's job is to complete every step + fill the // TODO gaps.
    const planSection = kit
      ? `\n\n## Build plan — complete EVERY step (a starter app/page.tsx exists; fill its // TODO gaps)\n${kit.plan(args.spec)}`
      : "";
    // The harness ALREADY downloaded the maker's uploads (the sandbox has no network)
    // → tell the agent where they are instead of the (broken) "curl these URLs".
    const mediaSection = args.attachmentUrls?.length
      ? `\n\n## Reference uploads (already in your workspace)\nThe maker's ${args.attachmentUrls.length} uploaded file(s) are in \`public/uploads/\` (web-served at \`/uploads/…\`). Geotagged photos also have a baked manifest at \`public/photos.json\` ([{file,lat,lng,takenAt}]); read it at runtime with \`fetch("/photos.json")\`. Build the app AROUND these files — they ship inside the deployed app.`
      : "";
    const task = buildTaskPrompt(args.spec, {
      project,
      // NOT attachmentUrls — the agent can't curl them (no network). They're pre-downloaded.
      tail: `${planSection}${mediaSection}\n\nWrite the code; the harness compiles it and sends back any build errors OR missing pieces to fix. You cannot run npm/next/vercel — the harness builds & deploys for you.`,
    });
    const tools = buildTools(sandbox, ws, deps.googleKey, (s) => void report.status(s));

    // Install deps CONCURRENTLY with the model's first editing round — the agent's
    // sandbox never touches node_modules, so the install overlaps the slow generation;
    // we await it before the first real `next build`. `bun install` (not npm) — much
    // faster cold-start, and the dominant cost on a fresh app. The build itself stays
    // `npx next build` (node-run: identical Next compile, no bun-runtime risk).
    const installing = backend.exec("bun install", { env: buildEnv, timeoutMs: BUILD_TIMEOUT_MS });
    let installChecked = false;

    // Token usage accumulated across rounds, surfaced for cost visibility/benchmarks.
    let inTokens = 0;
    let outTokens = 0;

    // Outer harness loop: the model implements/fixes, then WE run the authoritative
    // `next build` AND the anti-coast quality gate. Pass both → deploy. Build error OR
    // an incomplete (coasting) app → feed the specific gaps back for another round.
    // The model never decides "done" — the build + gate do.
    let feedback = ""; // build-error tail OR gate-missing list, for the next round's prompt
    let passed = false;
    let rounds = 0;
    for (let round = 0; round < MAX_BUILD_ROUNDS; round += 1) {
      rounds = round + 1;
      const prompt = round === 0 ? task : `${feedback}\n\nKeep going — fix and complete the app.`;
      await report.status(
        round === 0 ? "designing & building the jam" : `improving the jam (round ${round + 1})`
      );
      const gen = await generateText({ model, system, prompt, tools, stopWhen: stepCountIs(STEPS_PER_ROUND) });
      // totalUsage = aggregated across ALL tool-loop steps (write_file outputs live in
      // earlier steps); `usage` alone is just the final step and undercounts badly.
      inTokens += gen.totalUsage?.inputTokens ?? 0;
      outTokens += gen.totalUsage?.outputTokens ?? 0;

      if (!installChecked) {
        const install = await installing;
        installChecked = true;
        if (install.code !== 0) {
          await report.failed(`installing dependencies failed:\n${tail(install.stderr, 1000)}`);
          return;
        }
      }

      await report.status(`build check (attempt ${round + 1})`);
      const build = await backend.exec("npx next build", { env: buildEnv, timeoutMs: BUILD_TIMEOUT_MS });
      if (build.code !== 0) {
        feedback = `The build (\`next build\`, run by the harness) failed:\n\n${tail(build.stderr || build.stdout || "")}`;
        continue;
      }

      // Green build ≠ done: the seeded stub compiles. Gate on a real, SDK-using app
      // (generic anti-coast checks + any kit-specific probes). Fail ⇒ re-prompt.
      const page = await backend.readFile("app/page.tsx").catch(() => "");
      const base = genericGate(page, seedPage);
      const extra = kit ? kit.gate({ "app/page.tsx": page }).missing : [];
      const missing = [...base.missing, ...extra];
      if (missing.length === 0) {
        passed = true;
        break;
      }
      feedback = `The app COMPILES but is INCOMPLETE — do NOT stop yet. You still must:\n${missing.map((m) => `- ${m}`).join("\n")}`;
      await report.status(`quality check: needs work (round ${round + 1})`);
    }
    // Surface model cost (rides build.events; parsed by the benchmark, handy in prod).
    await report.status(`model usage — in:${inTokens} out:${outTokens} tokens, ${rounds} rounds`);
    if (!passed) {
      await report.failed(
        `couldn't produce a complete app after ${MAX_BUILD_ROUNDS} rounds.\n${tail(feedback, 1200)}`
      );
      return;
    }

    // Dry run: the build is green — stop before touching Vercel (safe local trials).
    // Report the PROSPECTIVE production URL (valid per /report's url() check) so the
    // build completes cleanly; the status line flags that nothing was deployed.
    if (deps.dryRun) {
      await report.status(`build is green ✓ (dry run — NOT deployed; source at ${ws})`);
      await report.done({
        entryUrl: `https://${project}.vercel.app`,
        vercelProject: project,
        neonProjectId,
      });
      return;
    }

    // Onchain games: the agent edited contracts/src/Game.sol in the SANDBOX, but it
    // can't DEPLOY (no forge/network). The HARNESS deploys it on the host now (forge +
    // ARC_DEPLOYER_KEY/ARC_OPERATOR_ADDRESS are in process.env), bakes lib/contract.ts,
    // and reports the address+abi so the platform wires sdk.onchain to the contract.
    let gameContract: { address: string; abi: readonly unknown[] } | undefined;
    if (args.spec.skills?.includes("onchain")) {
      await report.status("deploying the game contract to Arc");
      const cd = await backend.exec("bash contracts/deploy.sh", { timeoutMs: DEPLOY_TIMEOUT_MS });
      const jsonLine = cd.stdout.match(/\{[^\n]*"address"[^\n]*\}/)?.[0];
      if (cd.code !== 0 || !jsonLine) {
        await report.failed(`contract deploy failed (exit ${cd.code}): ${tail(cd.stderr || cd.stdout, 800)}`);
        return;
      }
      try {
        const parsed = JSON.parse(jsonLine) as { address?: string; abi?: unknown };
        if (!parsed.address || !Array.isArray(parsed.abi)) throw new Error("no address/abi in output");
        gameContract = { address: parsed.address, abi: parsed.abi };
        // Reference for the app (it reaches the chain via the SDK, not viem). Shipped
        // BEFORE `vercel deploy` so it's in the deployed source.
        await backend.writeFiles({
          "lib/contract.ts": `// Deployed by the harness — reference only (use sdk.onchain, not viem).\nexport const CONTRACT_ADDRESS = ${JSON.stringify(parsed.address)};\nexport const CONTRACT_ABI = ${JSON.stringify(parsed.abi)} as const;\n`,
        });
      } catch (e) {
        await report.failed(`couldn't parse the deployed contract: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }

    // Deploy the green app. v1: `vercel deploy --yes --prod` rebuilds remotely from
    // the verified source (the local build was the iteration gate). TODO optimization:
    // `vercel build` + `vercel deploy --prebuilt` to ship the exact artifact we built
    // and skip Vercel's second build.
    await report.status("deploying to the web");
    const cmd = [
      "vercel deploy --yes --prod",
      deps.vercelToken ? `--token ${deps.vercelToken}` : "",
      dsn ? `--env DATABASE_URL='${dsn}' --build-env DATABASE_URL='${dsn}'` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const dep = await backend.exec(cmd, { timeoutMs: DEPLOY_TIMEOUT_MS });
    if (dep.code !== 0) {
      await report.failed(`deploy failed (exit ${dep.code}): ${tail(dep.stderr, 800)}`);
      return;
    }
    let deploymentId = "";
    try {
      deploymentId = parseDeployOutput(dep.stdout).deploymentId;
    } catch {
      // URL is derived from the stable project alias below; id is diagnostic only.
    }

    // The public production alias is stable from the project name; queue.ts resolves
    // the REAL alias (Vercel truncates long auto-aliases) before recording it.
    await report.done({
      entryUrl: `https://${project}.vercel.app`,
      vercelProject: project,
      neonProjectId,
      contractAddress: gameContract?.address,
      contractAbi: gameContract?.abi,
    });
    console.log(`[harness] deployed ${project}${deploymentId ? ` (deployment ${deploymentId})` : ""}`);
  } catch (err) {
    await report.failed(err instanceof Error ? err.message : String(err));
  } finally {
    // Keep the workspace source (redeployable); strip heavy regenerable dirs.
    await backend.dispose().catch(() => {});
  }
};
