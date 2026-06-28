# Dynamic — Best Agentic Build · Unlink — Best Private Nano Payment App

SuperJam's stack is **Dynamic (wallets) + Unlink (privacy) + Arc (settlement) +
Circle (USDC)** — the exact combination the Unlink "Best Private Nano Payment App"
bounty asks for, and the agent-signing backbone the Dynamic "Best Agentic Build"
bounty rewards.

## Dynamic — Best Agentic Build
- **Embedded wallets**: email login → Dynamic TSS-MPC embedded wallet, no seed phrase
  (onboarding ladder, §15.1). The user's wallet is also the EIP-1193 provider Unlink
  wraps into a private account.
- **The agent's onchain signer is a LIVE Dynamic TSS-MPC server wallet**
  `0x159bA4a6e3358429cE134269a8D90Bf258e4E3ab` — NO raw key in the process: the key is
  split across Dynamic's MPC nodes (shares backed up at Dynamic, gated by a password),
  built at boot (`apps/server/src/dynamic-wallet.ts`) and injected as the `ServerWallet`
  into `createOnchainFromConfig`. It relays, custodies pot/build escrow, settles
  payments, and is the onchain escrow **hook arbiter** — the agent decides-then-executes
  through it. **Proven live (MPC-signed USDC tx on Arc, 2026-06-13):**
  `0x0cb38f71a0cff7a263ba4ad8689b55f1b76f4451eb25b39abf9e3692f2df16bd`.
  (The identity/treasury key `0x56592bA3…9904` is a separate role: StakeSlash
  arbiter/treasury + the Sepolia ENS-admin signer — NOT the money-rail agent signer.)
- **Agent identity**: builder agents are bound to a verified human (World ID) + given
  onchain identity (ERC-8004) + a resolvable ENS name — autonomous agents that transact.

## Unlink — Best Private Nano Payment App ($2k/$1k)
Requires Dynamic (wallet) + Unlink (private accounts/routing) + Circle (USDC) on Arc.
SuperJam's **private tips** and **payX402 nanopayments** are exactly this:
- **Dynamic** mints the wallet → its EIP-1193 provider builds the Unlink account
  (`account.fromMetaMask({ provider })`).
- **Unlink** (`@unlink-xyz/sdk`, `environment: "arc-testnet"`) gives a private balance:
  `transfer()` (private tips), `withdraw()` (payX402), `depositWithApproval()`
  (public→private top-up), `execute()` (private DeFi — e.g. private builder staking).
- **Arc** settles; **Circle USDC** is the unit; **transparent vs Unlink-private** are
  two rails on one chain (transparent = provable publish/pots; private = tips/nanopay).

### Onchain seam (this lane) vs browser (Opus P)
- `packages/onchain/src/privacy.ts` (`UnlinkClient`) + `unlink-transport.ts`
  (`UnlinkSdk`, `loadLiveUnlinkTransport`) + `circle-gateway.ts` — the server/transport
  seam. `@unlink-xyz/sdk@0.3.0-canary.598` installed; the live wiring recipe is grounded
  in `unlink-transport.ts`. `UNLINK_API_KEY` is provisioned (Railway).
- The user-facing private tip (Dynamic provider → Unlink account → `transfer`) is wired
  in the host confirm sheet (apps/web).

## Status
Dynamic embedded-wallet login + the sole-signer server wallet + agent identity are
live. Unlink: SDK installed, seam grounded; the live private-transfer wiring + browser
flow are being completed (privacy lane). Public fallback keeps the demo alive if the
private rail is unconfigured.
