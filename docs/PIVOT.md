# SuperJam — PIVOT (authoritative, supersedes SPEC where they conflict)

> Decision (user, 2026-06-13): **Track B is the only track.** Every mini-app is an
> **external, builder-hosted web app** loaded in a **cross-origin sandboxed iframe**.
> The platform keeps only: **identity + capability bridge + distribution (ENS/
> marketplace) + payments**. Full design: `~/.claude/plans/i-d-go-witht-he-spicy-
> wreath.md` (+ the Vercel/Neon deploy doc `…-agent-ac53a599c1bd36ecf.md`).
>
> This doc is the COORDINATION CONTRACT for the parallel agents. Read it before
> editing anything. Where it conflicts with SPEC.md, **PIVOT wins** (SPEC's full
> §6/§7/§11/§17 rewrite is deferred to P4).

## Architecture after the pivot

```
superjam.fun (Next host shell)
  └ /app/[slug] → look up app.entryUrl → <iframe src=entryUrl
       sandbox="allow-scripts allow-forms allow-same-origin allow-popups">
         dev-hosted app (Vercel) ── @superjam/sdk ── postMessage bridge (UNCHANGED)
  platform: identity tokens (JWKS) · payments/ai/messages/pot bridge · ENS/marketplace · World
  builder(s): generate → provision Neon → deploy Vercel → return entryUrl
```

The **SDK + bridge transport are already cross-origin-ready — no change.** What
changes: hosting (apps self-host), the app model (`entryUrl`), identity issuance
(platform mints ES256 tokens → JWKS), and the builder (it deploys, doesn't bundle).

## SPEC overrides (do not "fix" these back)

- **§6 sandbox**: ADD `allow-same-origin allow-popups`. Safe BECAUSE the app is
  cross-origin by URL — it gets *its own* origin (own cookies/storage/backend),
  SOP still walls it off from superjam.fun. (Inverts SPEC.md:421-424.)
- **§17 serving**: the host FRAMES `entryUrl` with a per-page CSP
  `frame-src 'self' <app.entryOrigin>`; it does NOT stream S3 bundles. `_plays`
  bump moves to the viewer mount (oRPC), not the `/a` route.
- **§11 builder**: emits source + DEPLOYS (Neon+Vercel) → returns `entryUrl`; no
  `Bun.build`, no S3 dist, no platform bundling.
- **Identity (new §1)**: platform mints short-lived ES256 app-tokens; external
  backends verify against `/.well-known/jwks.json` (aud=appId). `sdk.auth.getToken()`.

## Phasing (P1 additive — nothing gets ripped out until P4)

- **P1 (in flight, %67)**: identity issuer + JWKS + `auth.getToken`; `app.entryUrl/
  entryOrigin`; `apps.registerExternal` + `createExternalApp` core; `apps/web` host
  viewer (`app-frame.tsx`, per-page CSP, framing watchdog); the Next.js+SDK+Neon
  reference template.
- **P2 (Opus S)**: automated builder — generate from template → Neon → Vercel
  (prebuilt + warm pool, <30s) → `createExternalApp`.
- **P3 (Opus K)**: staked capability marketplace — on-chain stake/slash (Base/Arc
  testnet) + capability checklist + routing + layered optimistic-challenge judge
  (automated gate → AI score → owner + stake-to-challenge community dispute).
- **P4**: decommission Track A (remove static serve/S3/Bun.build, finalize SPEC).

## Keep / Change / Drop (condensed)

KEEP: bridge envelope + transport · host bridge lib · child SDK · Dynamic verifier ·
AppSpec/Manifest · storage/data/counter routers (now an OPTIONAL zero-backend tier —
serious apps bring their own Neon + verify the JWT).
ADD: `app-token.ts`/JWKS/`auth.getToken` (P1) · `app.entryUrl/entryOrigin` · `apps.
registerExternal`/`createExternalApp` · external-URL viewer · Next template · staking.
DROP (P4): `/a` S3 serving + LRU (`apps/server/src/serve.ts`) · `Bun.build`-in-submit ·
`app.bundleKey`/`ipfsCid` (stop writing now, nullable) · static Vite template.

## LANE OWNERSHIP MAP — hard boundaries (shared working tree, NO worktrees)

Each lane edits ONLY its files. Shared assembly files are append-only: pull
--rebase --autostash, add your one line, resolve trivially. NEVER `git add -A`.

| Lane | Pane | OWNS (edit only here) | Must NOT touch |
|---|---|---|---|
| **%67 Pivot/Frontend (P1)** | %67 | all of `apps/web/**`, `packages/api/src/auth/app-token.ts`, `routers/auth.ts`, `routers/apps.ts` (registerExternal/explore/get/recipe + reviews), `createExternalApp`, `app.db.ts` entryUrl cols, `packages/app-template` Next template (with B) | onchain, builder, payment/world/agents routers |
| **B sdk** | %66 | `packages/sdk`, `packages/app-template` | everything else |
| **S Builder (P2)** | %70 | `packages/builder/**`, `apps/builder/**`, `routers/builds.ts`, `bridge.ai` | apps/web, onchain, app-template |
| **C Chain (M6+M7)** | %71 | `packages/onchain/**` EXCEPT `staking/`, `routers/{publish,pot,payments}.ts`, `bridge.{pot,payments}`, `profile.topup` | apps/web, agents/world routers, onchain/staking |
| **K Marketplace+Staking+World (M8/P3)** | %69 | `packages/onchain/staking/**`, `routers/{world,agents}.ts`, the stake/slash contract + judge | apps/web, onchain root adapters (import chains.ts read-only) |
| **A Integrator (me)** | this | `router.ts` assembly, `server.ts` mounts, `packages/db` schema (except app.db.ts entryUrl), gateway/Docker/railway (M9), this doc, SPEC | lanes' files |

Cross-lane SEAMS (typed contracts, announce signatures in your first commit):
- C exports `buildTransferAuth` (ONE EIP-712 builder, client+server identical),
  `verifyUsdcTransfer({hash,chain,expectedTo,minAmount})→{from,value}` (verify by
  Transfer LOG, not tx.from — relayed EIP-3009 keeps signer in the log), branded
  `Usdc` (6-dec; Arc 18-vs-6 footgun §15), `createOnchain({publicClient,
  serverWallet})` (DB-FREE factory), and the `PaymentIntent` shape
  ({kind:"tip"|"publish"|"stake"|"payFriend", to, amountUsdc, appId?, memo?}).
- S calls `createExternalApp` (%67) + C's paid-build receipt verifier; until ready,
  wire as a try/catch seam (ENS/registration failure never fails a build).
- K imports C's chains.ts + `Usdc` read-only; stake/slash contract lives in
  `packages/onchain/staking/`. World verify (K) gates the human-only surface.
- Quotas reuse existing primitives (`_x402_quota` counter, `user.lastTopupAt`) —
  never build a parallel quota system.
