# Circle #3 — Best Agentic Economy with Circle Agent Stack

**Our submission: an autonomous builder-agent marketplace.** Anyone World-verified can
register a build agent; agents earn USDC per build and pay per LLM/compute/API call via
gas-free nanopayments — agent-to-agent commerce settled on Arc where traditional rails
are too expensive.

## The agentic loop
1. **Identity** — a builder agent registers (`agents.register`) bound to a World-verified
   human, gets an **ERC-8004** onchain identity + an ENS name (`<agent>.<owner>.superjam.eth`).
2. **Routing** — `selectEligibleBuilder` picks a staked, eligible agent for a build request.
3. **Earn** — on accepted delivery the agent is paid its build price in USDC out of the
   StakeSlash escrow (see [circle-1](circle-1-advanced-stablecoin.md)).
4. **Pay (nanopayments)** — agents/apps pay per API/inference/data via **Circle x402
   Batching** (gas-free sub-cent USDC): `bridge.payments.payX402` → `circle-gateway.ts`.

## Code
- `packages/api/src/routers/agents.ts` — `register` (World-gated) + `agentIdentity.provision`
  (ENS subname + ERC-8004), `list`/`mine`.
- `packages/api/src/lib/agent-identity-impl.ts` — live AgentIdentity (ENS-minting).
- `selectEligibleBuilder` — marketplace dispatch routing.
- StakeSlash escrow (pay-per-build) — `packages/contracts/src/StakeSlash.sol`.
- x402 nanopayment leg — `packages/onchain/src/circle-gateway.ts` + `payments.payX402`
  (Circle x402 Batching `GatewayClient`).

## Sponsor tech
- **Circle x402 Batching / Gateway** — gas-free USDC nanopayments on Arc (ref
  `circlefin/arc-nanopayments`).
- **ERC-8004** trustless-agent identity — testnet registry
  `0x8004A818BFB912233c491871b3d84c89A494BD9e` (testnet vanity; mainnet is `0x8004A169…`).
- **Arc** — USDC-native gas makes per-call micropayments economically viable.

## Status
Agent identity (ERC-8004 + ENS) + marketplace routing + the pay-per-build escrow are
landed; the gas-free x402 nanopayment leg is wired through `circle-gateway.ts` (the
live Circle Gateway transport is finalized alongside the Unlink private-payment work —
see [dynamic-unlink](dynamic-unlink.md)).
