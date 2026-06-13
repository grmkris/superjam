// StakeSlash viem bindings (PIVOT P3). The typed wrapper the platform calls to
// drive the escrow: arbiter writes go through C's ServerWallet (the sole
// privileged signer — never a raw key here), reads through the public client.
// DB-free + stateless like createOnchain: addresses + clients are injected, the
// api layer owns "which builder / which build". Tests stub the wallet + client
// at this seam (no chain).
import type { Address, Hex, PublicClient } from "viem";
import { keccak256, toHex } from "viem";
import type { Usdc } from "../money.ts";
import { usdc as asUsdc } from "../money.ts";
import type { ServerWallet } from "../server-wallet.ts";
import { type BuildStatus, BUILD_STATUS, stakeSlashAbi } from "./abi.ts";

/** Hash an api build id (typeid string) to the contract's bytes32 key. */
export const buildKey = (apiBuildId: string): Hex => keccak256(toHex(apiBuildId));

export interface OnchainBuild {
  builder: Address;
  price: Usdc;
  bond: Usdc;
  status: BuildStatus;
  deliveredAt: number;
  challenger: Address | null;
  challengeBond: Usdc;
}

export interface StakeSlashDeps {
  /** Deployed StakeSlash address (Arc — the money/settlement rail). */
  address: Address;
  /** The privileged signer — arbiter rulings + sponsored stake deposits. */
  serverWallet: ServerWallet;
  /** Arc client for state reads. */
  publicClient: PublicClient;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT = (1n << 256n) - 1n;

// USDC ERC-20 (approve + allowance) — `depositFor` pulls USDC from the server
// wallet (`_pullIn` does transferFrom), so it must be approved to StakeSlash once.
const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// SimpleYieldVault — read the underlying assets (principal + accrued yield) the
// vault holds for the escrow, to compute swept-able yield.
const VAULT_ABI = [
  {
    type: "function",
    name: "assetsOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const createStakeSlash = ({
  address,
  serverWallet,
  publicClient,
}: StakeSlashDeps) => {
  const write = (functionName: string, args: readonly unknown[]): Promise<Hex> =>
    serverWallet.writeContract({ address, abi: stakeSlashAbi, functionName, args });

  return {
    /** Assign a build to a staked builder — locks `bond`, escrows `price`. */
    registerBuild: (apiBuildId: string, builder: Address, price: Usdc, bond: Usdc) =>
      write("registerBuild", [buildKey(apiBuildId), builder, price, bond]),

    /** Open the challenge window after the automated deploy gate passes. */
    markDelivered: (apiBuildId: string) =>
      write("markDelivered", [buildKey(apiBuildId)]),

    /** Arbiter ruling: slash a bad delivery / resolve a challenge. */
    resolve: (apiBuildId: string, slashBuilder: boolean, delist: boolean) =>
      write("resolve", [buildKey(apiBuildId), slashBuilder, delist]),

    /** Builder's free (unlocked) stake. */
    freeStake: async (builder: Address): Promise<Usdc> => {
      const raw = (await publicClient.readContract({
        address,
        abi: stakeSlashAbi,
        functionName: "stake",
        args: [builder],
      })) as bigint;
      return asUsdc(raw);
    },
    /** Alias — a builder's current staked (free) balance, in USDC. */
    stakeOf: async (builder: Address): Promise<Usdc> => {
      const raw = (await publicClient.readContract({
        address,
        abi: stakeSlashAbi,
        functionName: "stake",
        args: [builder],
      })) as bigint;
      return asUsdc(raw);
    },

    /** Stake on behalf of a builder (arbiter-sponsored seed): pulls USDC from the
     *  server wallet, credits the builder's free stake, and `_pullIn` auto-supplies
     *  it to the yield vault. Ensures the one-time USDC approval to StakeSlash. */
    depositFor: async (builder: Address, amount: Usdc): Promise<Hex> => {
      const token = (await publicClient.readContract({
        address,
        abi: stakeSlashAbi,
        functionName: "usdc",
      })) as Address;
      const allowance = (await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [serverWallet.address, address],
      })) as bigint;
      if (allowance < amount) {
        await serverWallet.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [address, MAX_UINT],
        });
      }
      return write("depositFor", [builder, amount]);
    },

    /** Builder self-deposit USDC stake (server signs as itself — used for tests
     *  / platform staking). */
    deposit: (amount: Usdc) => write("deposit", [amount]),

    /** Withdraw unlocked free stake back to the caller. */
    withdraw: (amount: Usdc) => write("withdraw", [amount]),

    /** Yield accrued in the vault above tracked principal (swept to treasury by
     *  `harvest()`). Reads `yieldAdapter.assetsOf(escrow) - totalPrincipal`. */
    accruedYield: async (): Promise<Usdc> => {
      const vault = (await publicClient.readContract({
        address,
        abi: stakeSlashAbi,
        functionName: "yieldAdapter",
      })) as Address;
      if (vault === ZERO_ADDRESS) return asUsdc(0n);
      const [held, principal] = (await Promise.all([
        publicClient.readContract({
          address: vault,
          abi: VAULT_ABI,
          functionName: "assetsOf",
          args: [address],
        }),
        publicClient.readContract({
          address,
          abi: stakeSlashAbi,
          functionName: "totalPrincipal",
        }),
      ])) as [bigint, bigint];
      return asUsdc(held > principal ? held - principal : 0n);
    },

    /** Full on-chain build record (null if never registered). */
    getBuild: async (apiBuildId: string): Promise<OnchainBuild | null> => {
      const r = (await publicClient.readContract({
        address,
        abi: stakeSlashAbi,
        functionName: "builds",
        args: [buildKey(apiBuildId)],
      })) as readonly [Address, bigint, bigint, number, bigint, Address, bigint];
      const [builder, price, bond, status, deliveredAt, challenger, challengeBond] = r;
      if (BUILD_STATUS[status] === "none") {
        return null;
      }
      return {
        builder,
        price: asUsdc(price),
        bond: asUsdc(bond),
        status: BUILD_STATUS[status] ?? "none",
        deliveredAt: Number(deliveredAt),
        challenger: challenger === ZERO_ADDRESS ? null : challenger,
        challengeBond: asUsdc(challengeBond),
      };
    },
  };
};

export type StakeSlash = ReturnType<typeof createStakeSlash>;
