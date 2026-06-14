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

## Sponsor integrations

Where each partner technology is used. URLs below point at the line of code.

**World ID** ($15k) — proof-of-humanity gate: verifying you're a unique human is
required to publish a jam, review, register a builder, or top up, and it marks
builder agents as human-backed. Managed RP self-signs `rp_context`; full backend
proof verification against `/api/v4/verify/{rp_id}` binds the RP-scoped nullifier
to the account.

- backend verify + Sybil-bind — https://github.com/grmkris/superjam/blob/dev/packages/api/src/routers/world.ts#L66-L99
- managed-RP verifier — https://github.com/grmkris/superjam/blob/dev/packages/api/src/auth/world.ts#L157
- gate procedure — https://github.com/grmkris/superjam/blob/dev/packages/api/src/orpc.ts#L76
- IDKit v4 widget — https://github.com/grmkris/superjam/blob/dev/apps/web/src/components/world-gate-widget.tsx#L60

**Arc / Circle** ($15k) — the single money chain. Build fee, tips, and game
payouts settle in USDC on Arc using its USDC-native gas (no paymaster); users
sign gasless EIP-3009 transfers the server relays; CCTP bridges USDC from Sepolia
into native Arc USDC.

- Arc chain def — https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/chains.ts#L17
- EIP-3009 relay — https://github.com/grmkris/superjam/blob/dev/packages/api/src/routers/payments.ts#L135
- EIP-3009 typed-data — https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/transfer-auth.ts
- CCTP bridge — https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/cctp.ts

**Dynamic** ($10k) — how a wallet "appears with you." Email login → embedded EVM
wallet (no seed phrase); a TSS-MPC server wallet lets builder agents sign
autonomously; Dynamic JWTs authenticate the API; delegation lets a user's coding
agent build + pay as the user over MCP.

- embedded client — https://github.com/grmkris/superjam/blob/dev/apps/web/src/lib/dynamic-client.ts#L14
- pay signing — https://github.com/grmkris/superjam/blob/dev/apps/web/src/components/confirm/pay-executor.ts#L18
- MPC server wallet — https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/viem-server-wallet.ts#L65
- JWT auth — https://github.com/grmkris/superjam/blob/dev/packages/api/src/index.ts#L8
- delegation PAT — https://github.com/grmkris/superjam/blob/dev/packages/api/src/routers/auth.ts#L34

**Unlink** — the shielded private-payment rail. One `getUserSigner` seam wraps
each user's signer into a server-executed shielded account (no per-tx popup).

- unlink service — https://github.com/grmkris/superjam/blob/dev/packages/api/src/services/unlink-service.ts#L22

**Shared / nanopayments** (Arc × Unlink × Dynamic) — an agent pays for work,
privately, in USDC: **Dynamic** signs → **Unlink** shields → settles on **Arc**
(CCTP funds the shielded pool from Sepolia). The x402 pay-to-publish build fee
rides this exact stack, and is free when the payer is World-verified and the
builder is AgentBook-registered.

- agent hire — https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/agentkit-client.ts#L45
- CCTP funding — https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/cctp.ts

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
