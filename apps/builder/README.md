# SuperJam Builder

A **builder** turns a refined `AppSpec` into a live, hosted mini-app and hands SuperJam an
`entryUrl`. SuperJam frames that URL cross-origin; the app talks back through `@superjam/sdk`.
This is the **house builder** — but the protocol is open, so anyone can run their own
(see [Build your own builder](#build-your-own-builder)).

```
AppSpec ──▶ generate (Next.js + SDK [+ Neon schema])
        ──▶ provision Neon (if the app stores its own data)
        ──▶ deploy to Vercel ──▶ poll READY ──▶ { entryUrl, manifest }
```

## How a build runs (`src/in-memory-build.ts`)

Builds run as an **in-process loop** inside the builder service — no external agent CLI.
`runInMemoryBuild` drives the whole thing:

1. **Seed** a deterministic Next.js skeleton (`src/generate.ts` — correct auth / db / config /
   manifest boilerplate + a placeholder page; always works, no LLM). A matched **use-case kit**
   (`src/kits/`) may overlay a near-complete starter `app/page.tsx` with `// TODO` gaps.
2. **Fill** it with a coding model over the Vercel AI SDK `generateText` tool loop. The model
   only gets `write_file` / `read_file` + a **sandboxed `bash`** (just-bash: coreutils only, no
   host shell, no native binaries) plus the build-time `generate_image` / `generate_voice` tools.
   It edits files; it cannot run `npm`/`next`/`vercel`.
3. **Build + gate** on the host: the loop runs the authoritative `bun install` + `npx next build`,
   feeds any error back to the model, and once green runs the anti-coast quality gate
   (`src/kits/gate.ts`) — a green build that's an empty / off-theme stub is re-prompted, not shipped.
4. **Deploy** deterministically to Vercel (for onchain games, deploy the seeded Arc contract
   first), then report `{ entryUrl, … }` over the loopback `/report` protocol.

The coding model is **provider-agnostic** — `pickModel()` in `src/server.ts` builds it from
whichever API key is configured (`BUILD_PROVIDER` / `BUILD_MODEL`; Gemini Flash by default). No
key ⇒ the service refuses to boot (no silent fallback).

## The recipe corpus (`recipes/`)

Starting patterns the model imitates, selected per spec by `selectRecipes` (skill → category →
keyword). Read `recipes/_base.md` (the external-app contract) then the archetype recipes:
`quiz · game · poll-charts · market · predict · judge · data · social · realtime` (catalog in
`recipes/INDEX.md`). Most are **zero-backend** (platform `sdk.data`/`counter`/`pot`/`ai`);
only `data` (and sometimes `social`) use the app's own Neon backend (`apps/example-app` is the
reference shape).

## The builder protocol

The platform dispatches every build to a single house builder, configured via
`BUILDER_URL` + `BUILDER_TOKEN` on the server (the open marketplace was removed). A builder
implements the HTTP protocol (`src/app.ts`):

| Route | Behavior |
|---|---|
| `POST /builds` (Bearer) | accept `{ spec, buildId, appId }` → `202`; `429` when at capacity |
| `GET /builds/:id` (Bearer) | `{ status: "running"\|"done"\|"failed", result?: { entryUrl, manifest }, error? }` |
| `GET /health` | `{ ok: true }` |

Generate however you like, deploy to your own infra, and return a public `entryUrl`. To point
the platform at a different builder, set `BUILDER_URL`/`BUILDER_TOKEN` on the server service.
