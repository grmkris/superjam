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
  /** Deployed StakeSlash address (Base Sepolia, the public/provable rail). */
  address: Address;
  /** The sole privileged signer — executes arbiter rulings. */
  serverWallet: ServerWallet;
  /** Base Sepolia client for state reads. */
  publicClient: PublicClient;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
