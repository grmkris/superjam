// Per-user Unlink client (§23, the HYBRID model) — each user's shielded account
// derives from THEIR Dynamic wallet signature; the SERVER executes (no per-tx
// popup). The `account` injected here is the user's EVM signer: a plain key today
// (tests / server-key stand-in) and a Dynamic *delegated* signer later
// (createDelegatedEvmWalletClient → delegatedSignMessage/Transaction), so the
// server signs ON THE USER'S BEHALF with a scoped, revocable delegation.
//
// Composition is the one PROVEN LIVE on arc-testnet (see scripts/unlink-smoke.ts):
//   createUnlinkAdmin(apiKey) + account.fromEthereumSignature(<sig over CANON>)
//   + createUnlinkClient(admin-backed auth) → deposit / transfer / withdraw.
// The shielded token is native USDC 0x3600 funded via `deposit` (NOT the Unlink
// faucet, which mints a different test token). See [[unlink-live-on-arc]].
import { createUnlinkAdmin } from "@unlink-xyz/sdk/admin";
import { account as unlinkAccount, createUnlinkClient, evm as unlinkEvm } from "@unlink-xyz/sdk/client";
import {
  type Hex,
  type LocalAccount,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { CHAINS, PRIVATE_CHAIN, USDC } from "./chains.ts";
import { OnchainError } from "./errors.ts";
import { type Usdc } from "./money.ts";
// Canonical derivation message + scoping — defined in a web-safe module (no
// server-only SDK import) so the browser bootstrap step can sign the SAME bytes.
import {
  CANON_UNLINK_MESSAGE,
  UNLINK_APP_ID,
  UNLINK_ENVIRONMENT,
} from "./unlink-constants.ts";

// Re-export for existing direct importers (scripts/tests/server).
export { CANON_UNLINK_MESSAGE, UNLINK_APP_ID, UNLINK_ENVIRONMENT };

export interface UserUnlinkConfig {
  /** Unlink admin API key (server-side; control-plane: register + auth tokens). */
  apiKey: string;
  /** The user's EVM signer — signs the derivation message AND funds deposits.
   *  A viem LocalAccount now; a Dynamic delegated signer (same shape) later. */
  account: LocalAccount;
  /** RPC for the private chain (Arc). Defaults to the chain's default. */
  rpcUrl?: string;
}

export interface UserUnlink {
  /** The user's bech32m Unlink (shielded) address. */
  readonly unlinkAddress: string;
  /** Public → private: pull native USDC into the user's shielded balance. */
  deposit(amount: Usdc): Promise<Hex>;
  /** Private → private: the "tip" (send to a friend's Unlink address). */
  privateTransfer(toUnlinkAddress: string, amount: Usdc): Promise<Hex>;
  /** Private → public: unshield to an EVM address (the payX402 first leg). */
  withdraw(toEvmAddress: string, amount: Usdc): Promise<Hex>;
  /** Shielded balances [{ token, amount(decimal base-units string) }]. */
  getBalances(): Promise<{ token: string; amount: string }[]>;
}

/** Build a live, registered per-user Unlink client. Derives the account from the
 *  injected signer, registers it (idempotent), and returns the shielded ops. */
export const createUserUnlink = async (
  cfg: UserUnlinkConfig
): Promise<UserUnlink> => {
  if (!cfg.apiKey) {
    throw new OnchainError("CHAIN_UNAVAILABLE", "Unlink API key not configured");
  }
  const chain = CHAINS[PRIVATE_CHAIN];
  const token = USDC[PRIVATE_CHAIN].address;

  const admin = createUnlinkAdmin({
    environment: UNLINK_ENVIRONMENT,
    apiKey: cfg.apiKey,
  });
  const signature = await cfg.account.signMessage({
    message: CANON_UNLINK_MESSAGE,
  });
  const acct = unlinkAccount.fromEthereumSignature({
    signature,
    appId: UNLINK_APP_ID,
    chainId: chain.id,
  });
  const client = createUnlinkClient({
    environment: UNLINK_ENVIRONMENT,
    account: acct,
    authorizationToken: {
      provider: async (ctx) => {
        const t = await admin.authorizationTokens.issue({
          subjectType: "unlink_address",
          unlinkAddress: ctx.unlinkAddress,
        });
        return { token: t.token, expiresAt: t.expiresAt };
      },
    },
    register: (payload) => admin.users.register(payload),
  });

  const unlinkAddress = await client.getAddress();
  await client.ensureRegistered();

  // The EVM provider funds deposits (pulls native USDC from the user's wallet via
  // Permit2). Same signer as the derivation — a delegated signer drives both later.
  const transport = http(cfg.rpcUrl);
  const evmProvider = unlinkEvm.fromViem({
    walletClient: createWalletClient({ account: cfg.account, chain, transport }),
    publicClient: createPublicClient({ chain, transport }),
  });

  return {
    unlinkAddress,
    deposit: async (amount) => {
      const h = await client.depositWithApproval({
        token,
        amount: String(amount),
        evm: evmProvider,
      });
      return (await h.wait()).txHash as Hex;
    },
    privateTransfer: async (toUnlinkAddress, amount) => {
      const h = await client.transfer({
        token,
        amount: String(amount),
        recipientAddress: toUnlinkAddress,
      });
      return (await h.wait()).txHash as Hex;
    },
    withdraw: async (toEvmAddress, amount) => {
      const h = await client.withdraw({
        token,
        amount: String(amount),
        recipientEvmAddress: toEvmAddress,
      });
      return (await h.wait()).txHash as Hex;
    },
    getBalances: async () => (await client.getBalances()).balances ?? [],
  };
};
