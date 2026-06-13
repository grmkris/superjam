// @superjam/onchain — the chain adapter seam (§15/§16). DB-FREE and stateless:
// viem clients + the server wallet are injected via `createOnchain(...)`,
// mirroring `createCounterService({ db })`. No DB imports, no @username→address
// resolution — resolution / quotas / "which user" live in the api services;
// resolved addresses are passed in. A failed §23 rehearsal degrades behind this
// seam (tips→public, payX402 disabled) with no change to the call shape.
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  http,
} from "viem";
import { CHAINS, type ChainKey, PRIVATE_CHAIN, USDC } from "./chains.ts";
import { type EnsConfig, createEns } from "./ens.ts";
import { OnchainError } from "./errors.ts";
import { type Usdc } from "./money.ts";
import {
  type UnlinkClient,
  type UnlinkConfig,
  createUnlinkClient,
  nullUnlink,
} from "./privacy.ts";
import type { ServerWallet } from "./server-wallet.ts";
import type { TransferAuthMessage } from "./transfer-auth.ts";
import { createServerWalletFromKey } from "./viem-server-wallet.ts";
import {
  type VerifyTransferParams,
  usdcBalanceOf,
  verifyUsdcTransfer,
} from "./verify.ts";

export interface OnchainDeps {
  /** Base Sepolia client — the public/provable rail (verification, balances). */
  publicClient: PublicClient;
  /** The sole privileged signer (relay, escrow, ENS/8004). */
  serverWallet: ServerWallet;
  /** Arc testnet client (privacy rail reads). Optional — absent ⇒ Arc reads
   *  throw CHAIN_UNAVAILABLE and callers degrade to the public rail (§15). */
  arcClient?: PublicClient;
  /** The privacy rail. Defaults to the degraded client (public fallback). */
  unlink?: UnlinkClient;
  /** ENS L2Registry config (§16). Absent ⇒ ENS ops throw (S's pipeline
   *  try/catches; an ENS failure never fails a build). */
  ens?: EnsConfig;
}

export interface RelayParams {
  chain: ChainKey;
  authorization: TransferAuthMessage;
  signature: Hex;
}

export const createOnchain = ({
  publicClient,
  serverWallet,
  arcClient,
  unlink = nullUnlink,
  ens,
}: OnchainDeps) => {
  const clientFor = (chain: ChainKey): PublicClient => {
    if (chain === PRIVATE_CHAIN) {
      if (!arcClient) {
        throw new OnchainError("CHAIN_UNAVAILABLE", "Arc client not configured");
      }
      return arcClient;
    }
    return publicClient;
  };

  // ENS lives on the public L2 (Base Sepolia). Absent config ⇒ ops throw
  // ENS_WRITE_FAILED so callers degrade (an ENS failure never fails a build).
  const ensAdapter = ens
    ? createEns(publicClient, serverWallet, ens)
    : null;
  const requireEns = () => {
    if (!ensAdapter) {
      throw new OnchainError("ENS_WRITE_FAILED", "ENS registry not configured");
    }
    return ensAdapter;
  };

  return {
    /** The privileged signer's address — treasury-of-record for escrow/relay. */
    serverAddress: serverWallet.address,

    /** The privacy rail client (faucet for top-up; tips use it client-side). */
    unlink,

    /** Verify a public-rail receipt by its Transfer log (publish/stake/build). */
    verifyUsdcTransfer: (params: VerifyTransferParams) =>
      verifyUsdcTransfer(clientFor(params.chain), params),

    /** Read a USDC balance (6-dec) on a chain — reads ONE source, never sums. */
    usdcBalance: (chain: ChainKey, account: Address) =>
      usdcBalanceOf(clientFor(chain), chain, account),

    /** Submit a user-signed EIP-3009 authorization, pay the gas, return the real
     *  tx hash (§13). The single gasless public-rail path. */
    relayTransfer: ({ chain, authorization, signature }: RelayParams) =>
      serverWallet.relayTransfer({ token: USDC[chain], authorization, signature }),

    /** Send USDC from the server wallet (top-up public rail, pot payout). */
    sendUsdc: (chain: ChainKey, to: Address, value: Usdc): Promise<Hex> =>
      serverWallet.sendUsdc({ token: USDC[chain], to, value }),

    // --- ENS (§16) — the seam S's build pipeline imports. Degrade-safe. ---
    /** Ensure `username.<parent>` exists (idempotent). */
    ensureUserNode: (username: string, owner: Address) =>
      requireEns().ensureUserNode(username, owner),
    /** Mint `slug.username.<parent>` + set app.* text records. */
    mintApp: (params: Parameters<NonNullable<typeof ensAdapter>["mintApp"]>[0]) =>
      requireEns().mintApp(params),
    /** The chain-sourced catalog (backs the feed, §16). */
    listFromEns: () => requireEns().listFromEns(),
  };
};

export type Onchain = ReturnType<typeof createOnchain>;

export interface OnchainConfig {
  /** The privileged signer key. Absent ⇒ null (boot stays green; payments
   *  return INTERNAL until configured). Swap for a Dynamic account to go TSS. */
  serverWalletPrivateKey?: string;
  baseSepoliaRpcUrl?: string;
  arcRpcUrl?: string;
  unlink?: UnlinkConfig;
  /** ENS L2Registry (§16). Absent ⇒ ENS ops degrade (never fail a build). */
  ens?: EnsConfig;
}

/** Compose a live Onchain from env-style config — the composition-root wiring
 *  (apps/server). Returns null when no signer key is set so the caller falls
 *  back to nullOnchain. Unlink stays degraded until a transport is wired (§23). */
export const createOnchainFromConfig = (cfg: OnchainConfig): Onchain | null => {
  if (!cfg.serverWalletPrivateKey) return null;
  const publicClient = createPublicClient({
    chain: CHAINS.baseSepolia,
    transport: http(cfg.baseSepoliaRpcUrl),
  });
  const serverWallet = createServerWalletFromKey({
    privateKey: cfg.serverWalletPrivateKey as Hex,
    rpcUrl: cfg.baseSepoliaRpcUrl,
    chainKey: "baseSepolia",
  });
  const arcClient = cfg.arcRpcUrl
    ? createPublicClient({ chain: CHAINS.arcTestnet, transport: http(cfg.arcRpcUrl) })
    : undefined;
  return createOnchain({
    publicClient,
    serverWallet,
    arcClient,
    unlink: cfg.unlink ? createUnlinkClient(cfg.unlink) : nullUnlink,
    ens: cfg.ens,
  });
};

/** Degraded onchain — every chain op rejects with CHAIN_UNAVAILABLE so the api
 *  layer maps it to a clean error and boot/tests stay green without chain
 *  config (mirrors nullUnlink / nullAppTokenIssuer). The server injects the
 *  real instance; tests inject a mock. */
export const nullOnchain: Onchain = {
  serverAddress: "0x0000000000000000000000000000000000000000",
  unlink: nullUnlink,
  verifyUsdcTransfer: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  usdcBalance: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  relayTransfer: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  sendUsdc: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  ensureUserNode: () =>
    Promise.reject(new OnchainError("ENS_WRITE_FAILED", "ENS not configured")),
  mintApp: () =>
    Promise.reject(new OnchainError("ENS_WRITE_FAILED", "ENS not configured")),
  listFromEns: () =>
    Promise.reject(new OnchainError("ENS_WRITE_FAILED", "ENS not configured")),
};

// --- public surface (the cross-lane seams) ---
export * from "./money.ts";
export * from "./chains.ts";
export * from "./transfer-auth.ts";
export * from "./payment-intent.ts";
export * from "./server-wallet.ts";
export * from "./viem-server-wallet.ts";
export * from "./privacy.ts";
export * from "./circle-gateway.ts";
export * from "./unlink-transport.ts";
export * from "./ens.ts";
export * from "./verify.ts";
export * from "./errors.ts";
