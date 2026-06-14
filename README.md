# SuperJam

> A super-app host for the open web: email login → embedded EVM wallet
> (Dynamic), third-party **jams** (mini apps) in sandboxed iframes with an
> injected SDK (wallet + profile + storage + shared data), an AI agent that
> builds + deploys new jams from a prompt, gated by World ID + a pay-to-publish
> fee in USDC. Verified humans get their own ENS name
> (`username.superjam.eth`) and their jams publish under it
> (`appslug.username.superjam.eth`).

Built for **ETHGlobal NYC 2026**. Testnet-only posture, two chains: **Arc
testnet** (money — USDC tips/payments, on-chain game contracts) + **Ethereum
Sepolia L1** (identity — ENSv2 names + ERC-8004 agent identity, CCTP source).
The full build bible is
[`SPEC.md`](./SPEC.md); design is [`docs/DESIGN_BRIEF.md`](./docs/DESIGN_BRIEF.md)
+ [`docs/design/`](./docs/design/) (the round-8 Toybox mockups are authoritative
for look/UX).

## Monorepo layout (§4)

```
apps/
  web/          Next.js 16 host shell + host bridge lib
  server/       Bun + Hono + oRPC backend (identity tokens, payments, bridge)
  gateway/      Caddy
packages/
  sdk/          @superjam/sdk — child-side bridge client + SDK.md
  api/          oRPC routers + context
  db/           Drizzle schema + migrations (Postgres 17)
  shared/       SERVICE_URLS, env schema, typeid, capabilities, constants,
                bridge envelope zod schemas
  onchain/      viem chains, USDC helpers, ENSv2 mint/read, ERC-8004 + agent wallet
  builder/      generate → deploy (Vercel + Neon) → register pipeline
  app-template/ the mini-app template + skills/ + examples/
  logger/       thin pino wrapper
```

## Toolchain

Bun 1.3.x workspaces + Turborepo, `catalog:` pins. Postgres 17 + MinIO via
Docker for local infra. See [`docs`](./docs) and `SPEC.md` §4 for the full pin
list.

## Getting started

```bash
bun install
cp .env.example .env          # fill core creds (§1)
docker compose up -d          # postgres :47432 + minio :47900/:47901
bun run db:generate           # produce SQL migration from the Drizzle schema
bun run db:migrate            # apply it
```

Ports: web `4700`, server `4701`, builder `4710` (dev-box only), pg `47432`,
minio `47900`/`47901`.

## The gate

After each milestone (M0→M9, §20), this must pass — one commit per milestone:

```bash
bun run typecheck && bun run lint && bun test && bun run build
```

## Dev flow (§18)

Two long-lived branches: `dev` (default, auto-deploys → `dev.superjam.fun`) and
`main` (production). Commit to `dev`; promote via a reviewed merge-commit PR.
The **builder** service (`apps/builder`) does not run on Railway — it lives on
the kristjan-dev VPS (`builder.superjam.fun`); see `SPEC.md` §11/§18.
