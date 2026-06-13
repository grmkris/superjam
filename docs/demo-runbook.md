# SuperJam — judge runbook (web3 prizes)

Everything below is **live on testnet** and verifiable independently. SuperJam runs
on **two chains**: **Arc testnet** (chain `5042002`, the money + settlement layer —
gas paid in USDC) and **Ethereum Sepolia L1** (`11155111`, identity + naming: ENSv2
+ ERC-8004). App: **https://dev.superjam.fun**.

Explorers: Arc `https://testnet.arcscan.app` · Sepolia `https://sepolia.etherscan.io`
/ `https://sepolia.app.ens.domains`.

---

## 🤖 Best Agentic Build (Dynamic)
**Claim:** the agent signs + executes onchain via a **Dynamic TSS-MPC server wallet**
— no raw private key in the process (shares split across Dynamic's MPC nodes, gated by
a password). This is the agent's hands: it decides (route a build, mint a name, settle
a payment) and executes onchain itself.

- **Agent signer (Dynamic MPC):** `0x159bA4a6e3358429cE134269a8D90Bf258e4E3ab`
- **Fresh live proof (MPC-signed USDC tx on Arc, 2026-06-13):**
  `0x0cb38f71a0cff7a263ba4ad8689b55f1b76f4451eb25b39abf9e3692f2df16bd`
  → https://testnet.arcscan.app/tx/0x0cb38f71a0cff7a263ba4ad8689b55f1b76f4451eb25b39abf9e3692f2df16bd
- Code: `apps/server/src/dynamic-wallet.ts` (`createDynamicServerWallet` → injected as
  the `ServerWallet` into `createOnchainFromConfig`). Boot logs `agent signer: Dynamic
  TSS-MPC server wallet`. The same wallet is the **hook arbiter** of the onchain escrow.
- **Judge check:** open the tx — `from` = the MPC wallet `0x159b`, a real USDC transfer.

## ✨ Best Money App (Dynamic + USDC)
**Claim:** USDC payments end to end with **no seed phrase, no gas token, no network
picker** — email → Dynamic embedded wallet; Arc pays gas in USDC so users only ever
hold USDC. Every action (publish fee, social pots, tips, builder stakes, build pay) is
a USDC flow on one chain.
- Same proof tx as above is a real USDC transfer on Arc (`USDC 0x3600…0000`, 6-dec).
- **Judge check:** sign in at dev.superjam.fun with email (Dynamic), see a USDC
  balance, no gas/network friction.

## ⚡ Circle — Arc / Advanced Stablecoin / Agentic Economy (×3)
**All live on Arc** (`packages/contracts/deployments/arc-testnet.json`):
- **#1 Advanced Stablecoin Logic** — yield-bearing conditional escrow: `StakeSlash`
  `0x90E8C7da6AA73d0000ffa9fC0cb906Df2aeEc4E6` + `SimpleYieldVault`
  `0x020d3C641b6Fd1edf1c04Dc813829086FB0e1266` (idle stake/escrow earns yield → treasury,
  principal returned exact). Full lifecycle proven live (see `docs/bounties/circle-1`).
- **#2 Chain-Abstracted USDC** — CCTP V2 burn→attest→mint into Arc (+ atomic escrow
  hook `0xf67d…4ec8` / `0xA527…BD29`). Live tx proof in `docs/bounties/circle-2`.
- **#3 Agentic Economy** — builder-agents (ERC-8004 identity) earn USDC per build via
  the escrow (`docs/bounties/circle-3`).
- **Judge check:** all five contracts return code on Arc (verified 2026-06-13); the
  `docs/bounties/circle-*` write-ups cite the live tx hashes.

## 🌐 ENS — resolvable agent/jam names
**Claim:** every jam gets `<slug>.superjam.eth`, **ENSv2-native on Sepolia**, resolvable
in standard ENS tooling (viem/ethers/app.ens.domains) — not a closed L2 registry.
- SuperjamRegistry (one self-contained IRegistry+resolver under `superjam.eth`):
  `0x822fd916803E1F611Cc65EE342B2DdffbaAd1EE4` (Sepolia).
- Live names (each resolves to its real owner `0x7aC0d718…`):
  `guestbook.superjam.eth`, `tip-jar.superjam.eth`, `final-pot-demo.superjam.eth`,
  `mascot-draw-off.superjam.eth`, `world-cup-trivia.superjam.eth`,
  `spending-explainer.superjam.eth`, + the user node `kristjangrm1.superjam.eth`.
- **Judge check:** open `https://sepolia.app.ens.domains/guestbook.superjam.eth` — it
  resolves to an address. (UR walk: EthRegistry `0xdedb…` → getSubregistry("superjam")
  → `0x822f` → getResolver(slug) → addr.)

## 🧍 World ID — proof of human
**Claim:** humans gate the privileged actions (publish, reviews, register-a-builder),
and builder agents are bound to a verified human. Managed RP 4.0, **registered +
on-chain initialized** (production + staging).
- `app_id app_9872a081d613877707b8059fc094a5cd`, `rp_id rp_e0b752bb9dda4a05`.
- Status: `production_status: registered`, `on_chain.production_initialized: true`.
- Verify endpoint: `/api/v4/verify/rp_e0b752bb9dda4a05`.
- **Judge check:** trigger a gated action on dev (publish / leave a review) → the World
  ID flow runs (staging = simulator).

---

### One-line proof list (for the submission)
- Dynamic MPC agent tx (Arc): `0x0cb38f71a0cff7a263ba4ad8689b55f1b76f4451eb25b39abf9e3692f2df16bd`
- StakeSlash / vault (Arc): `0x90E8C7da…c4E6` / `0x020d3C64…1266`
- SuperjamRegistry (Sepolia ENSv2): `0x822fd916…1EE4` — `guestbook.superjam.eth` resolves
- World ID RP: `rp_e0b752bb9dda4a05` (registered, on-chain initialized)
- Address source of truth: `packages/contracts/deployments/{arc-testnet,sepolia}.json`
