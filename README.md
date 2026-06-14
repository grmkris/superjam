# SuperJam

> A super-app host for the open web: email login → embedded EVM wallet (Dynamic),
> third-party **jams** (mini apps) running in sandboxed iframes with an injected
> SDK (wallet + profile + storage + shared data), and an AI agent that builds and
> deploys new jams from a one-sentence prompt — gated by World ID + a small
> pay-to-publish fee in USDC. Verified humans get their own ENS name
> (`username.superjam.eth`) and their jams publish under it
> (`appslug.username.superjam.eth`).

**Live:** [superjam.fun](https://superjam.fun) · dev: [dev.superjam.fun](https://dev.superjam.fun) · Built for **ETHGlobal NYC 2026**

Testnet-only, two chains: **Arc testnet** (money — USDC tips/payments + on-chain
game contracts) and **Ethereum Sepolia L1** (identity — ENSv2 names + ERC-8004
agent identity, CCTP source).

## How it works

- **Host shell** (`apps/web`) — the consumer app: sign in with email, a wallet
  appears with you, discover jams in a vertical feed, and play them live.
- **Jams** are sandboxed mini-apps in iframes. The host injects an SDK over
  `postMessage` (wallet · profile · key-value storage · shared cross-jam data);
  every sensitive action (payments, confirmations) stays in the host, so jams
  never touch your wallet.
- **The builder agent** turns a prompt into a real app: prompt → plan → an AI
  builder designs, builds, and deploys it (Next-on-Vercel apps or standalone Vite
  games) in about a minute.
- **On-chain identity & money** — verified humans claim an ENS name and each jam
  publishes under it; jams hold and pay out real USDC on Arc. Partner/sponsor
  integrations are detailed in [`hack.md`](./hack.md).

## Monorepo layout

```
apps/
  web/          Next.js 16 host shell + host bridge lib
  server/       Bun + Hono + oRPC backend (identity tokens, payments, bridge)
  builder/      builder deploy service (runs on the VPS, not Railway)
  gateway/      Caddy
  example-app/  reference jam built against the SDK
packages/
  sdk/          @superjam/sdk — child-side bridge client + SDK.md
  api/          oRPC routers + context
  db/           Drizzle schema + migrations (Postgres 17)
  shared/       SERVICE_URLS, env schema, typeid, capabilities, constants,
                bridge envelope zod schemas
  onchain/      viem chains, USDC helpers, ENSv2 mint/read, ERC-8004 + agent wallet
  contracts/    Foundry contracts — StakeSlash stake/slash + yield vault
  builder/      generate → deploy (Vercel + Neon) → register pipeline (used by apps/builder)
  app-template/ the mini-app template + skills/ + examples/
  logger/       thin pino wrapper
```

## Toolchain

Bun 1.3.x workspaces + Turborepo with `catalog:` pins. Postgres 17 + MinIO via
Docker for local infra. Full pin list + architecture live in [`SPEC.md`](./SPEC.md).

## Getting started

```bash
bun install
cp .env.example .env          # fill core creds (see SPEC.md)
docker compose up -d          # postgres :47432 + minio :47900/:47901
bun run db:generate           # produce a SQL migration from the Drizzle schema
bun run db:migrate            # apply it
```

Ports: web `4700`, server `4701`, builder `4710` (dev-box only), pg `47432`,
minio `47900`/`47901`.

## Before you push

These must pass (`lint` runs oxlint):

```bash
bun run typecheck && bun run lint && bun test && bun run build
```

## Dev flow

Two long-lived branches: `dev` (default, auto-deploys → `dev.superjam.fun`) and
`main` (production → `superjam.fun`). Commit to `dev`; promote via a reviewed
merge-commit PR — never push `main` directly. The **builder** service
(`apps/builder`) does not run on Railway — it lives on the kristjan-dev VPS
(`builder.superjam.fun`).

## Docs

| Doc | What's in it |
| --- | --- |
| [`SPEC.md`](./SPEC.md) | Full build spec — [`docs/PIVOT.md`](./docs/PIVOT.md) is the authoritative override. |
| [`hack.md`](./hack.md) | Hackathon submission: sponsor/prize integrations, difficulty ratings, feedback. |
| [`docs/DESIGN_BRIEF.md`](./docs/DESIGN_BRIEF.md) | The Toybox design language (look + UX). |
| [`docs/bounties/`](./docs/bounties/) | On-chain proofs + live testnet contract addresses. |
| [`docs/pitch/`](./docs/pitch/) | Pitch deck + [`DEMO-SCRIPT.md`](./docs/pitch/DEMO-SCRIPT.md). |
| [`docs/demo-runbook.md`](./docs/demo-runbook.md) | Judge verification runbook (testnet evidence). |
| [`docs/mcp-onboarding.md`](./docs/mcp-onboarding.md) | Drive SuperJam from Claude Code over MCP. |
