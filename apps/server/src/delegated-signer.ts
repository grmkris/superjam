// Per-user signer via Dynamic Delegated Access — "the flow blessed by Dynamic"
// (agentic finance). The user grants delegation (auto-prompt on sign-in) → Dynamic
// fires the `wallet.delegation.created` webhook → we decrypt the share with our
// delegation private key → persist it → sign AS the user server-side. No raw key
// custody: only a scoped, revocable MPC share. Server-only (Dynamic Node SDK), so
// it lives in apps/server (NOT @superjam/onchain, which the web bundle imports).
import {
  type EncryptedDelegatedPayload,
  decryptDelegatedWebhookData,
} from "@dynamic-labs-wallet/node";
import {
  type DelegatedEvmWalletClient,
  createDelegatedEvmWalletClient,
  delegatedSignMessage,
  delegatedSignTransaction,
  delegatedSignTypedData,
} from "@dynamic-labs-wallet/node-evm";
import { type UnlinkService, createUnlinkService } from "@superjam/api";
import { type Address, type Hex, type LocalAccount, toHex } from "viem";
import { toAccount } from "viem/accounts";

/** The decrypted share type, taken from the SDK's decrypt result (avoids a deep
 *  type import). */
type ServerKeyShare = ReturnType<
  typeof decryptDelegatedWebhookData
>["decryptedDelegatedShare"];

/** Per-user delegation material we persist (decrypted from the webhook). */
export interface DelegationCreds {
  /** The user's Dynamic embedded-wallet id. */
  walletId: string;
  /** Share-set id from the `wallet.delegation.created` payload (optional — the
   *  server resolves it from walletId when omitted). */
  shareSetId?: string;
  /** The wallet's EVM address (the viem account address). */
  address: Address;
  /** Decrypted per-wallet API key. */
  walletApiKey: string;
  /** Decrypted MPC key share. */
  keyShare: ServerKeyShare;
}

/** Decrypt a `wallet.delegation.created` webhook's encrypted material with our
 *  delegation private key (PEM, from the Dynamic dashboard). Returns the share +
 *  wallet API key to persist (keyed to the user). */
export const decryptDelegation = (params: {
  privateKeyPem: string;
  encryptedDelegatedKeyShare: EncryptedDelegatedPayload;
  encryptedWalletApiKey: EncryptedDelegatedPayload;
}): { decryptedDelegatedShare: ServerKeyShare; decryptedWalletApiKey: string } =>
  decryptDelegatedWebhookData(params);

export interface DelegatedUnlinkDeps {
  /** Dynamic environment id. */
  environmentId: string;
  /** Dynamic server API token (the `dyn_…` dashboard token). */
  dynamicApiKey: string;
  /** Unlink admin API key (the private rail). */
  unlinkApiKey: string;
  /** Arc RPC for the private chain. */
  rpcUrl?: string;
  /** Funded EOA key for the platform welcome-faucet shielded pool (ARC_PAYER_EOA_KEY). */
  faucetKey?: string;
  /** Load the persisted per-user delegation creds (populated by the webhook). */
  loadCreds: (userId: string) => Promise<DelegationCreds | null>;
}

/** A per-user signer factory: `getUserSigner(userId)` returns a viem `LocalAccount`
 *  that signs AS the user via Dynamic delegated signing (the decrypted MPC share).
 *  Used both by the Unlink rail and the World/AgentKit attestation (eip191). */
export interface DelegatedSigner {
  getUserSigner: (userId: string) => Promise<LocalAccount>;
}

/** Build the per-user delegated signer. Standalone so the AgentKit "human-backed"
 *  lane (§14) can derive the user's eip191 signer without the full Unlink service. */
export const createDelegatedSigner = (deps: {
  environmentId: string;
  dynamicApiKey: string;
  loadCreds: (userId: string) => Promise<DelegationCreds | null>;
}): DelegatedSigner => {
  const client: DelegatedEvmWalletClient = createDelegatedEvmWalletClient({
    environmentId: deps.environmentId,
    apiKey: deps.dynamicApiKey,
  });

  const getUserSigner = async (userId: string): Promise<LocalAccount> => {
    const c = await deps.loadCreds(userId);
    if (!c) {
      throw new Error(`No Dynamic delegation on file for user ${userId}`);
    }
    const base = {
      walletId: c.walletId,
      shareSetId: c.shareSetId,
      walletApiKey: c.walletApiKey,
      keyShare: c.keyShare,
    };
    return toAccount({
      address: c.address,
      // Unlink derivation signs a fixed string (CANON_UNLINK_MESSAGE); the `raw`
      // path is converted best-effort for completeness.
      signMessage: async ({ message }) => {
        const msg =
          typeof message === "string"
            ? message
            : typeof message.raw === "string"
              ? message.raw
              : toHex(message.raw);
        return (await delegatedSignMessage(client, {
          ...base,
          message: msg,
        })) as Hex;
      },
      signTransaction: async (transaction) =>
        (await delegatedSignTransaction(client, {
          ...base,
          transaction,
        })) as Hex,
      signTypedData: async (typedData) =>
        (await delegatedSignTypedData(client, {
          ...base,
          typedData: typedData as never,
        })) as Hex,
    });
  };

  return { getUserSigner };
};

/** Build the live per-user `UnlinkService` whose `getUserSigner` signs AS the user
 *  via Dynamic delegated signing. Inject the result into `createContext({unlink})`
 *  in server.ts. */
export const createDelegatedUnlinkService = (
  deps: DelegatedUnlinkDeps
): UnlinkService => {
  const { getUserSigner } = createDelegatedSigner({
    environmentId: deps.environmentId,
    dynamicApiKey: deps.dynamicApiKey,
    loadCreds: deps.loadCreds,
  });

  return createUnlinkService({
    apiKey: deps.unlinkApiKey,
    rpcUrl: deps.rpcUrl,
    getUserSigner,
    faucetKey: deps.faucetKey,
  });
};
