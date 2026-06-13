// The agent's onchain signer as a Dynamic TSS-MPC server wallet (Best Agentic
// Build, §1). No raw private key anywhere: the key is split across MPC nodes;
// this process holds only the non-sensitive `walletMetadata` + a password, while
// the key shares are backed up at Dynamic (`backUpToDynamic: true`). Built at
// boot and injected into `createOnchainFromConfig` as a pre-made `ServerWallet`,
// so every relay / ENS mint / escrow write is signed by the Dynamic wallet.
//
// Server-only: the Dynamic Node SDK pulls Node APIs, so it lives here in
// apps/server (NOT in @superjam/onchain, which the web bundle imports).
import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import {
  CHAINS,
  type ChainKey,
  type ServerWallet,
  createServerWallet,
} from "@superjam/onchain";
import type { Account, PublicClient, WalletClient } from "viem";

export interface DynamicWalletEnv {
  /** Server-level Dynamic API credential (the dashboard `dyn_…` token). */
  authToken: string;
  environmentId: string;
  /** `JSON.stringify(walletMetadata)` from `createWalletAccount` (provisioned once). */
  walletMetadataJson: string;
  /** Gates signing; required because the wallet was created with backUpToDynamic. */
  password: string;
}

/** Present only when every Dynamic server-wallet var is set — else undefined so
 *  the caller keeps the raw-key fallback (tests / rehearsal). */
export const dynamicWalletEnv = (): DynamicWalletEnv | undefined => {
  const authToken =
    process.env.DYNAMIC_AUTH_TOKEN ?? process.env.DYNAMIC_API_TOKEN;
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
  const walletMetadataJson = process.env.DYNAMIC_SERVER_WALLET_METADATA;
  const password = process.env.WALLET_PASSWORD;
  if (!authToken || !environmentId || !walletMetadataJson || !password) {
    return undefined;
  }
  return { authToken, environmentId, walletMetadataJson, password };
};

// One authenticated MPC client, reused across chains (the wallet address is the
// same on every EVM chain — we just bind a per-chain viem client).
let clientPromise: Promise<DynamicEvmWalletClient> | undefined;
const getClient = (env: DynamicWalletEnv): Promise<DynamicEvmWalletClient> => {
  clientPromise ??= (async () => {
    const c = new DynamicEvmWalletClient({
      environmentId: env.environmentId,
      enableMPCAccelerator: false, // true only on AWS Nitro Enclave infra
    });
    await c.authenticateApiToken(env.authToken);
    return c;
  })();
  return clientPromise;
};

/** Build a `ServerWallet` (the existing onchain seam) backed by the Dynamic
 *  TSS-MPC wallet on `chainKey`. The MPC wallet signs every tx via Dynamic's
 *  relay — no key material in this process. */
export const createDynamicServerWallet = async (
  env: DynamicWalletEnv,
  chainKey: ChainKey,
  rpcUrl?: string,
): Promise<ServerWallet> => {
  const evm = await getClient(env);
  const walletMetadata = JSON.parse(env.walletMetadataJson);
  const chain = CHAINS[chainKey];
  // Shares recovered from Dynamic's backup (backUpToDynamic), gated by password.
  const walletClient = await evm.getWalletClient({
    walletMetadata,
    password: env.password,
    chain,
    rpcUrl,
  });
  const publicClient = evm.createViemPublicClient({ chain, rpcUrl });
  return createServerWallet({
    account: walletClient.account as Account,
    walletClient: walletClient as WalletClient,
    publicClient: publicClient as PublicClient,
  });
};
