// The privileged signer, viem-backed (§15.1). Implements `ServerWallet` over a
// viem wallet client. The default construction is a funded PLAIN KEY — exactly
// the §23 rehearsal fallback, and the safe demo default. The Dynamic TSS-MPC
// server wallet (no raw key) is a drop-in behind this same interface (§1): swap
// the `account` for a Dynamic viem-interop account, everything else identical.
import {
  type Account,
  type Hex,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, type ChainKey } from "./chains.ts";
import { OnchainError } from "./errors.ts";
import type {
  RelayTransferArgs,
  SendUsdcArgs,
  ServerWallet,
  WriteContractArgs,
} from "./server-wallet.ts";

// EIP-3009 `transferWithAuthorization` — the `bytes signature` overload
// (FiatTokenV2_2) so we relay the user's EIP-712 sig without splitting v/r/s.
const EIP3009_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface ServerWalletDeps {
  account: Account;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

/** Wrap pre-built viem clients as a `ServerWallet`. */
export const createServerWallet = ({
  account,
  walletClient,
  publicClient,
}: ServerWalletDeps): ServerWallet => {
  const submit = async (
    write: () => Promise<Hex>,
    failCode: "RELAY_FAILED" = "RELAY_FAILED"
  ): Promise<Hex> => {
    let hash: Hex;
    try {
      hash = await write();
    } catch (err) {
      throw new OnchainError(failCode, String(err));
    }
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  return {
    address: account.address,

    relayTransfer: ({ token, authorization, signature }: RelayTransferArgs) =>
      submit(() =>
        walletClient.writeContract({
          account,
          chain: walletClient.chain,
          address: token.address,
          abi: EIP3009_ABI,
          functionName: "transferWithAuthorization",
          args: [
            authorization.from,
            authorization.to,
            authorization.value,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            signature,
          ],
        })
      ),

    sendUsdc: ({ token, to, value }: SendUsdcArgs) =>
      submit(() =>
        walletClient.writeContract({
          account,
          chain: walletClient.chain,
          address: token.address,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [to, value],
        })
      ),

    writeContract: ({ address, abi, functionName, args }: WriteContractArgs) =>
      submit(() =>
        walletClient.writeContract({
          account,
          chain: walletClient.chain,
          address,
          // The generic write seam (ENS/8004/pot payout) — abi is caller-typed.
          abi: abi as never,
          functionName,
          args: args as never,
        })
      ),
  };
};

/** Convenience: build a `ServerWallet` from a funded private key + RPC on a
 *  chain. This is what `apps/server` calls at boot (the single reused signer,
 *  §15.1). Swap `privateKeyToAccount` for a Dynamic account to go TSS-MPC. */
export const createServerWalletFromKey = ({
  privateKey,
  rpcUrl,
  chainKey = "arcTestnet",
}: {
  privateKey: Hex;
  rpcUrl?: string;
  chainKey?: ChainKey;
}): ServerWallet => {
  const chain = CHAINS[chainKey];
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  return createServerWallet({ account, walletClient, publicClient });
};
