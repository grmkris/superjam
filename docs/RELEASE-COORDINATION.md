# Release coordination — Arc→Base + ship to prod (overnight 2026-06-29)

Goal (from user): **everything on prod, all features WORKING on Base Sepolia (testnet)
by morning.** Three agents share the `dev` branch — stay in your lane, `git pull --rebase`
before every push, **explicit-path commits only** (never `git add -A`).

## Lanes
- **1.0 — `apps/web`** (immersive-jam-redesign)
- **1.1 — `apps/builder`** (drop-agent-build-driver)
- **1.2 — chain switch + CI + release** (`packages/{onchain,shared,contracts}`, `apps/server`,
  `.github/`, this doc) ← me

## Status (1.2 / chain + release)
- ✅ **Arc → Base migration done & typecheck-green** (13/13 packages): money chain is now
  **Base**, defaulting to **Base Sepolia** everywhere (incl. prod) — set
  `MONEY_CHAIN=baseMainnet` (+ `NEXT_PUBLIC_MONEY_CHAIN`) to flip a funded deploy to real money.
  - `packages/onchain/src/chains.ts` (base chains + USDC addrs), `money.ts` (Arc-native removed),
    `index.ts`/`viem-server-wallet.ts` (`arcRpcUrl`→`baseRpcUrl`), `apps/server/src/server.ts`,
    `packages/shared/src/{service-urls,env}.ts` (`ARC_RPC_URL`→`BASE_RPC_URL`, `MONEY_CHAIN`).
- ⏳ CI workflow, full build/test, commit+push dev, prod promotion — in progress.

## ⚠️ Action needed from 1.1 (apps/builder) — onchain game-deploy retarget to Base
I did **not** touch `apps/builder` (your uncommitted lane). The onchain game-contract deploy
still targets **Arc** and must move to **Base Sepolia** for onchain-game jams to work:
- `apps/builder/src/generate.ts` deploySh: default RPC `https://rpc.testnet.arc.network`
  → `https://sepolia.base.org`; env vars `ARC_DEPLOYER_KEY`/`ARC_OPERATOR_ADDRESS`/`ARC_RPC_URL`
  → Base equivalents (or keep names, repoint values). `apps/builder/src/env.ts` comments.
- Needs a **Base Sepolia-funded deployer** + operator = server wallet (see funding note below).
- (Inert without funds, so non-blocking for tonight's core ship — but required for onchain games.)

## Prod promotion plan (1.2 will drive once dev is green & all lanes coherent)
`dev`→`main` **merge-commit** PR. **Will NOT promote if dev isn't cleanly green.** Money/onchain
features need the server wallet funded with **Base Sepolia ETH** + contracts deployed to Base
Sepolia — flagged for morning if faucets block autonomous funding.

_Last updated by 1.2._
