// StakeSlash ABI (hand-authored to match StakeSlash.sol). viem reads/writes are
// typed off this const. SPEC-GAP: regenerate from the foundry artifact once the
// contract is compiled + deployed at the event; the function/event signatures
// here are the source of truth for the bindings until then.
export const stakeSlashAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "registerBuild",
    stateMutability: "nonpayable",
    inputs: [
      { name: "buildId", type: "bytes32" },
      { name: "builder", type: "address" },
      { name: "price", type: "uint256" },
      { name: "bond", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markDelivered",
    stateMutability: "nonpayable",
    inputs: [{ name: "buildId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "challenge",
    stateMutability: "nonpayable",
    inputs: [{ name: "buildId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "nonpayable",
    inputs: [{ name: "buildId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "buildId", type: "bytes32" },
      { name: "slashBuilder", type: "bool" },
      { name: "delist", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "view",
    inputs: [{ name: "builder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "builds",
    stateMutability: "view",
    inputs: [{ name: "buildId", type: "bytes32" }],
    outputs: [
      { name: "builder", type: "address" },
      { name: "price", type: "uint256" },
      { name: "bond", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "deliveredAt", type: "uint64" },
      { name: "challenger", type: "address" },
      { name: "challengeBond", type: "uint256" },
    ],
  },
] as const;

/** Build lifecycle, mirrors the Solidity `Status` enum (index = on-chain value). */
export const BUILD_STATUS = [
  "none",
  "assigned",
  "delivered",
  "finalized",
  "slashed",
] as const;
export type BuildStatus = (typeof BUILD_STATUS)[number];
