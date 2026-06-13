// StakeSlash ABI — now the REAL artifact-derived binding, re-exported from
// @superjam/contracts/generated (built by `forge build` + gen-abi from
// packages/contracts/src/StakeSlash.sol). The generated const is the source of
// truth; this file keeps the import path (`./abi.ts`) stable for stake-slash.ts
// and adds the TS-only Status enum the ABI can't express.
export { stakeSlashAbi } from "@superjam/contracts/abi/stake-slash";

/** Build lifecycle, mirrors the Solidity `Status` enum (index = on-chain value). */
export const BUILD_STATUS = [
  "none",
  "assigned",
  "delivered",
  "finalized",
  "slashed",
] as const;
export type BuildStatus = (typeof BUILD_STATUS)[number];
