---
name: register-builder
description: Register a new SuperJam builder agent end-to-end — insert the marketplace row and provision its on-chain identity (ENS `<slug>.superjam.eth` + ERC-8004 NFT + StakeSlash yield stake), then print the optional World AgentBook human-backing step. Use when the user wants to onboard / create a new builder agent for the SuperJam marketplace.
---

# Register a SuperJam builder agent

A builder agent is an AI coder in the SuperJam marketplace, **backed by a verified
human**, that earns USDC per jam. Registering one runs the SINGLE shared
`createBuilderAgent` path — identical whether a community member registers through
the website, the platform seeds its fleet, or you run this skill. Each agent gets:

- a marketplace row (`builder_agent`) with model / price / capabilities / wallet,
- an **ENS** subname `<slug>.superjam.eth` (resolvable in standard ENS tooling),
- an **ERC-8004** identity NFT (transferred to the agent's wallet),
- a sponsored **1-USDC StakeSlash** yield stake (the agent's slashable reputation bond),
- *(optional, out-of-band)* a **World AgentBook** human-backing badge.

The engine is `packages/api/scripts/create-agent.ts` (DB-direct — runs on the box,
no auth gate). This skill drives its **single-agent mode** via `AGENT_*` env vars.

## Steps

1. **Gather the agent's params** from the user (ask for any that are missing):
   - `slug` — kebab-case, unique (the ENS label). e.g. `acme`.
   - `name` — display name. e.g. `Acme Builder`.
   - `model` — `claude-opus-4-8` (premium) or `claude-sonnet-4-6` (cheap). Forwarded to the builder per build.
   - `price` — USDC per jam, e.g. `2` (or `0.5`).
   - `caps` — comma-separated capability keys. Common: `frontend`, `hosting:vercel`,
     `database:neon`, `contracts:evm`, `ai`. The platform routes a build only to
     agents holding every required capability.
   - `wallet` — the agent's payout wallet (`0x…`). **Recommended:** a fresh Dynamic
     MPC wallet (see step 2). Any address the operator controls also works.

2. **Provision a wallet (recommended: Dynamic MPC).** If the user doesn't already
   have a wallet for the agent, create a Dynamic TSS-MPC wallet — the same kind the
   fleet uses (`@dynamic-labs-wallet/node-evm`, `createWalletAccount({
   thresholdSignatureScheme: "TWO_OF_TWO", password, backUpToDynamic: true })`; see
   `apps/server/src/dynamic-wallet.ts` for the live wiring). Capture the address +
   metadata. The MPC keyGen ceremony can transiently stall on the Dynamic relay —
   if it hangs > ~60s, retry. No funding is needed (the platform sponsors the
   identity + seed stake `depositFor` the agent).

3. **Get the dev DB URL.** `DEV_DB_URL` = the Railway dev Postgres **public** URL
   (Postgres service → `DATABASE_PUBLIC_URL`, via the Railway MCP or dashboard).
   The on-chain creds (`SERVER_WALLET_PRIVATE_KEY`, `ARC_RPC_URL`, `SEPOLIA_RPC_URL`,
   `ENS_V2_*`, `ERC8004_REGISTRY`, `STAKE_SLASH_ADDRESS`) come from the repo `.env`.

4. **Register the agent** (DB-direct, single-agent mode):

   ```bash
   DEV_DB_URL="<railway dev postgres public url>" \
   BUILDER_TOKEN="<the builder endpoint's dispatch token>" \
   AGENT_SLUG="acme" AGENT_NAME="Acme Builder" \
   AGENT_MODEL="claude-opus-4-8" AGENT_PRICE="2" \
   AGENT_CAPS="frontend,hosting:vercel,database:neon" \
   AGENT_WALLET="0xYourAgentWallet" \
     bun packages/api/scripts/create-agent.ts
   ```

   It prints the minted ENS name, the ERC-8004 id, and the staked USDC + tx. It is
   **idempotent by slug** — re-running skips an existing agent; add `--refresh` to
   backfill a missing ENS / 8004 id / stake on an already-registered agent.

5. **Optional — human-back it in World AgentBook.** The script prints the exact
   command. Registration is gasless + authorized by the human's World App (the agent
   wallet does NOT sign):

   ```bash
   npx @worldcoin/agentkit-cli register <agent-wallet>
   ```

   Then the agent card shows "human-backed ✓" once detection is wired. Skipping this
   is fine — it's never required.

6. **Verify.** The agent now appears in the marketplace (`/agents`) and the make-flow
   builder picker. Optionally confirm on-chain: `ownerOf(<erc8004Id>)` on the
   IdentityRegistry returns the agent's wallet; `stakeOf(<wallet>)` on StakeSlash
   returns the seed stake.

## Notes
- This is the platform/manual entry point. The **website** path (`/agents/register`
  → `agents.register`) runs the same `createBuilderAgent` for community builders.
- The wallet is a payment **recipient** — agents don't sign x402 build-fee payments
  (the maker pays the agent's wallet via the public USDC rail).
- Never commit secrets. Pass `DEV_DB_URL` / `BUILDER_TOKEN` inline, not into a file.
