// @superjam/onchain/staking (K's lane, PIVOT P3) — the staked builder
// marketplace's economic + judgment core. The on-chain stake/slash escrow
// (StakeSlash.sol) + its viem bindings, and the layered optimistic judge that
// decides what the escrow does on each delivery. Imports C's chains/money
// read-only; the api/server wires the bindings to live dispatch (deferred).
export * from "./abi.ts";
export * from "./stake-slash.ts";
export * from "./judge.ts";
