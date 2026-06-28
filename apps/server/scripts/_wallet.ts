// Shared: build the SAME server wallet apps/server uses, for the x402 live-test
// scripts. Prefers the Dynamic TSS-MPC wallet (0x159b…, the bounty signer) when
// DYNAMIC_* env is present; falls back to the funded raw key (SERVER_WALLET_PRIVATE_KEY).
// Run from the repo root so Bun auto-loads `.env`. The chosen wallet's address +
// Arc USDC balance are logged so you can see whether you're on the funded wallet.
import {
  PUBLIC_CHAIN,
  type ServerWallet,
  createServerWalletFromKey,
} from "@superjam/onchain";
import { arcTestnet } from "@superjam/onchain/chains";
import { type PublicClient, createPublicClient, formatUnits, http } from "viem";
import {
  createDynamicServerWallet,
  dynamicWalletEnv,
} from "../src/dynamic-wallet.ts";

export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
/** Circle Gateway Wallet on Arc testnet (same address every testnet chain). */
export const GATEWAY_WALLET =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
/** Arc-testnet Circle Gateway domain id. */
export const ARC_GATEWAY_DOMAIN = 26;
export const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const arcPublicClient = (): PublicClient =>
  createPublicClient({
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL),
  }) as PublicClient;

export const usdcBalance = async (
  pc: PublicClient,
  addr: `0x${string}`
): Promise<bigint> =>
  pc.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;

/** The depositor's available Circle Gateway balance (off-chain ledger), in atomic USDC. */
export const gatewayAvailable = async (
  depositor: `0x${string}`
): Promise<bigint> => {
  const res = await fetch(`${GATEWAY_API}/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "USDC",
      sources: [{ depositor, domain: ARC_GATEWAY_DOMAIN }],
    }),
  });
  const data = (await res.json()) as {
    balances?: { balance: string }[];
    message?: string;
  };
  if (!res.ok) throw new Error(`Gateway balances ${res.status}: ${data.message}`);
  const raw = data.balances?.[0]?.balance ?? "0";
  // The API returns a decimal USDC string; convert to atomic (6dp).
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole + (frac + "000000").slice(0, 6));
};

/** Build the server wallet (Dynamic preferred, raw-key fallback) + log its identity. */
export const buildServerWallet = async (): Promise<ServerWallet> => {
  const dynEnv = dynamicWalletEnv();
  let wallet: ServerWallet;
  if (dynEnv) {
    wallet = await createDynamicServerWallet(
      dynEnv,
      PUBLIC_CHAIN,
      process.env.ARC_RPC_URL
    );
    console.log(`signer: Dynamic TSS-MPC wallet ${wallet.address}`);
  } else {
    const key = process.env.SERVER_WALLET_PRIVATE_KEY;
    if (!key) throw new Error("No DYNAMIC_* env and no SERVER_WALLET_PRIVATE_KEY");
    wallet = createServerWalletFromKey({
      privateKey: key as `0x${string}`,
      rpcUrl: process.env.ARC_RPC_URL,
      chainKey: "arcTestnet",
    });
    console.log(`signer: raw-key fallback wallet ${wallet.address}`);
  }
  const pc = arcPublicClient();
  const bal = await usdcBalance(pc, wallet.address);
  console.log(`  Arc USDC balance: ${formatUnits(bal, 6)} USDC`);
  return wallet;
};
