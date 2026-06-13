# Circle #2 — Best Chain-Abstracted USDC App (Arc as a Liquidity Hub)

**Our submission: source build-funding from any CCTP chain into the Arc builder
economy in one action.** A client funds a build with USDC on Base Sepolia (or any
CCTP chain); CCTP V2 burns it there and mints native USDC on Arc — optionally with a
`hookData` that atomically deposits into the StakeSlash escrow on arrival. Users treat
multiple chains as one liquidity surface; Arc is the settlement hub.

## Flow

```mermaid
sequenceDiagram
  participant C as Client (Base Sepolia)
  participant TM as TokenMessengerV2 (src)
  participant Iris as Circle Iris (attestation)
  participant MT as MessageTransmitterV2 (Arc)
  participant E as Arc escrow / wallet
  C->>TM: approve USDC + depositForBurn(destDomain=26, mintRecipient, maxFee 0, finality 2000)
  TM-->>Iris: MessageSent(message)
  Iris-->>Iris: attest (~minutes)
  C->>MT: receiveMessage(message, attestation)
  MT->>E: mint native USDC on Arc (+ optional hook → escrow.deposit)
```

## Code
- `packages/onchain/src/cctp.ts` — `createCctp({source,dest,iris}).bridge({amount,
  mintRecipient})`: approve (await receipt) → `depositForBurn` → `fetchAttestation`
  (Iris poller, injectable fetch) → `receiveMessage`. Domains/addresses + `toBytes32`.
- Tests: `packages/onchain/src/cctp.test.ts` — domains, bytes32 padding, the Iris
  poller (polls past pending → complete; times out → `RELAY_FAILED`).
- Live proof: `packages/onchain/integration/cctp.itest.ts` (gated
  `RUN_ONCHAIN_INTEGRATION=1`) bridges a real amount Base Sepolia → Arc.

## Addresses (CCTP V2 testnet — same CREATE2 on every chain)
- TokenMessengerV2 `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- MessageTransmitterV2 `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- TokenMinterV2 `0xb43db544E2c27092c107639Ad201b3dEfAbcF192`
- Domains: **Base Sepolia 6 → Arc 26** (Ethereum Sepolia 0 also supported).
- Iris (sandbox): `https://iris-api-sandbox.circle.com/v2/messages/{srcDomain}?transactionHash=…`

## Live cross-chain proof (real txs, 2026-06-13)
A real CCTP V2 transfer run end-to-end via `cctp.ts`: 0.05 USDC burned on Base Sepolia
→ Iris attested (after Base Sepolia finalization, ~13 min) → minted native USDC on Arc.
Pre-flight confirmed CCTP V2 is live on Arc: `MessageTransmitter.localDomain() == 26`.

| step | chain | tx |
|---|---|---|
| `depositForBurn` (burn) | Base Sepolia (domain 6) | `0x35dd94874688ed7b04304224748def16abeb3ffe3601e1204aacc6e0191552df` |
| `receiveMessage` (mint) | Arc (domain 26) | `0x1d019c71aa6fdf6851efa275df0fb1262759f527e5b8ca880fccbdeecdf6d7df` |

(Burn on `sepolia.basescan.org`; mint on `https://testnet.arcscan.app`.)

## Status
Adapter built + unit-tested + **proven live** (table above). `bridge()` mints to a
wallet today; the `hookData` variant (atomic deposit into the StakeSlash escrow on
arrival) is the documented extension — not yet wired.
