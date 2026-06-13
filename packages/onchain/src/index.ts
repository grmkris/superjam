// @superjam/onchain — the chain adapter seam (§15/§16). DB-FREE and stateless:
// viem clients + the server wallet are injected via `createOnchain(...)`,
// mirroring `createCounterService({ db })`. No DB imports, no @username→address
// resolution — resolution / quotas / "which user" live in the api services;
// resolved addresses are passed in. Creds (signer, Unlink, ENS) are assumed
// configured in any real environment — the only credential-less path is the
// secret-less CI/image build (SKIP_ENV_VALIDATION), handled by `nullOnchain`.
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { CHAINS, type ChainKey, PUBLIC_CHAIN, USDC } from "./chains.ts";
import { type EnsConfig, createEns } from "./ens.ts";
import { type EnsV2, type EnsV2Config, createEnsV2 } from "./ens-v2.ts";
import { type Erc8004Config, createErc8004 } from "./erc8004.ts";
import { OnchainError } from "./errors.ts";
import { type Usdc } from "./money.ts";
import { createServerWallet } from "./viem-server-wallet.ts";
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
  /** Durin/ENS lives on Base Sepolia even when PUBLIC_CHAIN is Arc — so ENS reads
   *  + subname mints use this dedicated Base Sepolia client + signer, not the Arc
   *  public rail. Falls back to publicClient/serverWallet when unset. */
  ensClient?: PublicClient;
  ensWallet?: ServerWallet;
  /** ERC-8004 reference registries (§16). Absent ⇒ 8004 ops degrade (never fail
   *  a register/review). Signs through the same Base-Sepolia ens client+wallet. */
  erc8004?: Erc8004Config;
  /** ENSv2-native adapter — mints `<slug>.superjam.eth` resolvable in STANDARD
   *  ENS tooling (Sepolia L1, distinct from Durin's Base-Sepolia L2). Pre-built
   *  in createOnchainFromConfig. Absent ⇒ the v2 mint degrades (build unaffected). */
  ensV2?: EnsV2;
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
  ensClient,
  ensWallet,
  erc8004,
  ensV2,
}: OnchainDeps) => {
  const clientFor = (chain: ChainKey): PublicClient => {
    // publicClient is built for PUBLIC_CHAIN (Arc). A secondary `arcClient` slot
    // holds any OTHER chain's client (e.g. the Base Sepolia CCTP source, #2).
    if (chain === PUBLIC_CHAIN) return publicClient;
    if (arcClient) return arcClient;
    throw new OnchainError("CHAIN_UNAVAILABLE", `no client for ${chain}`);
  };

  // ENS lives on the public L2 (Base Sepolia). Absent config ⇒ ops throw
  // ENS_WRITE_FAILED so callers degrade (an ENS failure never fails a build).
  // ENS is on Base Sepolia (Durin), distinct from the Arc public rail — use the
  // dedicated ENS client+signer when provided, else fall back.
  const ensAdapter = ens
    ? createEns(ensClient ?? publicClient, ensWallet ?? serverWallet, ens)
    : null;
  const requireEns = () => {
    if (!ensAdapter) {
      throw new OnchainError("ENS_WRITE_FAILED", "ENS registry not configured");
    }
    return ensAdapter;
  };

  // ERC-8004 shares the platform's IDENTITY CHAIN with ENS (the canonical
  // reference registries are at the same CREATE2 address on Sepolia + Base
  // Sepolia) — so it reuses the dedicated identity client+signer. Absent config ⇒
  // ops throw so callers degrade (a register/feedback failure never fails the
  // agent register / the review).
  const erc8004Adapter = erc8004
    ? createErc8004(ensClient ?? publicClient, ensWallet ?? serverWallet, erc8004)
    : null;
  const requireErc8004 = () => {
    if (!erc8004Adapter) {
      throw new OnchainError("ERC8004_WRITE_FAILED", "ERC-8004 registry not configured");
    }
    return erc8004Adapter;
  };

  const requireEnsV2 = () => {
    if (!ensV2) {
      throw new OnchainError("ENS_WRITE_FAILED", "ENSv2 registry not configured");
    }
    return ensV2;
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

    // --- ENSv2-native (§16) — the RESOLVABLE name (standard ENS tooling). ---
    /** Mint `<slug>.superjam.eth` natively in ENSv2 (Sepolia L1) -> owner. */
    mintV2Subname: (params: Parameters<NonNullable<typeof ensV2>["mintSubname"]>[0]) =>
      requireEnsV2().mintSubname(params),

    // --- ERC-8004 (§14/§16) — agent identity + reputation. Degrade-safe. ---
    /** Mint the agent's ERC-8004 identity NFT (→ the builder's wallet). */
    registerAgentIdentity: (
      params: Parameters<NonNullable<typeof erc8004Adapter>["registerAgentIdentity"]>[0]
    ) => requireErc8004().registerAgentIdentity(params),
    /** Record a verified review as ERC-8004 feedback. */
    writeReputation: (
      params: Parameters<NonNullable<typeof erc8004Adapter>["writeReputation"]>[0]
    ) => requireErc8004().writeReputation(params),
    /** Aggregate the platform-written feedback for an agent (profile). */
    readReputation: (erc8004Id: string) => requireErc8004().readReputation(erc8004Id),
  };
};

export type Onchain = ReturnType<typeof createOnchain>;

export interface OnchainConfig {
  /** The privileged signer key — assumed present in any real environment. The
   *  only absent case is the secret-less CI/image build (→ nullOnchain). Prefer
   *  a pre-built Dynamic TSS account (below); this raw key drives the same signer. */
  serverWalletPrivateKey?: string;
  /** Pre-built signer (Dynamic TSS-MPC server wallet) — takes precedence over
   *  the raw key when present (built async at boot in apps/server, §1). */
  serverWallet?: ServerWallet;
  /** Pre-built ENS signer on Base Sepolia — defaults to the Dynamic wallet. */
  ensWallet?: ServerWallet;
  baseSepoliaRpcUrl?: string;
  arcRpcUrl?: string;
  unlink?: UnlinkConfig;
  /** ENS L2Registry (§16). Absent ⇒ ENS ops degrade (never fail a build). */
  ens?: EnsConfig;
  /** ERC-8004 reference registries (§16). Absent ⇒ 8004 ops degrade. */
  erc8004?: Erc8004Config;
  /** ENSv2-native config (SuperjamRegistry on Sepolia L1, §16). Absent ⇒ the v2
   *  mint degrades. Built into the live adapter with a dedicated Sepolia signer. */
  ensV2?: EnsV2Config;
  /** Sepolia (L1) RPC — the ENSv2 chain. Required for the v2 mint. */
  sepoliaRpcUrl?: string;
  /** Dedicated ENSv2 signer key — MUST own the SuperjamRegistry. Distinct from
   *  the payment signer (the Dynamic wallet); this is the platform/ENS admin key. */
  ensV2SignerKey?: string;
}

/** Compose a live Onchain from env-style config — the composition-root wiring
 *  (apps/server). A signer (Dynamic TSS account or raw key) is assumed present;
 *  returns null ONLY in the secret-less CI/image build so typecheck/build stay
 *  green without creds (the caller substitutes nullOnchain). */
export const createOnchainFromConfig = (cfg: OnchainConfig): Onchain | null => {
  if (!cfg.serverWallet && !cfg.serverWalletPrivateKey) return null;
  // Public/provable rail = PUBLIC_CHAIN (Arc). Gas = USDC on Arc, so the server
  // wallet relays/sends paying USDC — no ETH/paymaster. RPC picked per chain.
  const publicRpc =
    PUBLIC_CHAIN === "arcTestnet" ? cfg.arcRpcUrl : cfg.baseSepoliaRpcUrl;
  const publicClient = createPublicClient({
    chain: CHAINS[PUBLIC_CHAIN],
    transport: http(publicRpc),
  });
  const serverWallet =
    cfg.serverWallet ??
    createServerWalletFromKey({
      privateKey: cfg.serverWalletPrivateKey as Hex,
      rpcUrl: publicRpc,
      chainKey: PUBLIC_CHAIN,
    });
  // Secondary client = the OTHER chain (Base Sepolia when public is Arc) — used
  // for cross-chain reads (the CCTP #2 source). Stored in the `arcClient` slot
  // (= "non-public client" via clientFor).
  const secondaryRpc =
    PUBLIC_CHAIN === "arcTestnet" ? cfg.baseSepoliaRpcUrl : cfg.arcRpcUrl;
  const secondaryChain =
    PUBLIC_CHAIN === "arcTestnet" ? CHAINS.baseSepolia : CHAINS.arcTestnet;
  const arcClient = secondaryRpc
    ? createPublicClient({ chain: secondaryChain, transport: http(secondaryRpc) })
    : undefined;
  // ENS/Durin AND the ERC-8004 registries live on Base Sepolia regardless of
  // PUBLIC_CHAIN — build a dedicated Base Sepolia client + signer for them (same
  // key, Base Sepolia chain) whenever either is configured.
  const needsBaseSepolia = Boolean(cfg.ens || cfg.erc8004);
  const ensClient = needsBaseSepolia
    ? createPublicClient({ chain: CHAINS.baseSepolia, transport: http(cfg.baseSepoliaRpcUrl) })
    : undefined;
  const ensWallet = needsBaseSepolia
    ? (cfg.ensWallet ??
      createServerWalletFromKey({
        privateKey: cfg.serverWalletPrivateKey as Hex,
        rpcUrl: cfg.baseSepoliaRpcUrl,
        chainKey: "baseSepolia",
      }))
    : undefined;
  // ENSv2-native: SuperjamRegistry on Sepolia (L1) — a self-contained
  // IRegistry+resolver the agent owns. Distinct chain + signer from Durin's Base
  // Sepolia: a dedicated Sepolia ServerWallet from ensV2SignerKey (the platform/
  // ENS admin key that owns the registry), NOT the Dynamic payment wallet.
  const ensV2Adapter =
    cfg.ensV2 && cfg.sepoliaRpcUrl && cfg.ensV2SignerKey
      ? (() => {
          const sepoliaClient = createPublicClient({
            chain: sepolia,
            transport: http(cfg.sepoliaRpcUrl),
          });
          const account = privateKeyToAccount(cfg.ensV2SignerKey as Hex);
          const sepoliaWallet = createServerWallet({
            account,
            walletClient: createWalletClient({
              account,
              chain: sepolia,
              transport: http(cfg.sepoliaRpcUrl),
            }),
            publicClient: sepoliaClient,
          });
          return createEnsV2(sepoliaClient, sepoliaWallet, cfg.ensV2);
        })()
      : undefined;
  return createOnchain({
    publicClient,
    serverWallet,
    arcClient,
    unlink: cfg.unlink ? createUnlinkClient(cfg.unlink) : nullUnlink,
    ens: cfg.ens,
    ensClient,
    ensWallet,
    erc8004: cfg.erc8004,
    ensV2: ensV2Adapter,
  });
};

/** Build/test-only seam — NOT a runtime fallback. Every chain op rejects with
 *  CHAIN_UNAVAILABLE so the secret-less CI/image build (SKIP_ENV_VALIDATION) and
 *  unit tests stay green without creds (mirrors nullUnlink / nullAppTokenIssuer).
 *  Any real deploy injects the live instance; tests inject a mock. */
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
  mintV2Subname: () =>
    Promise.reject(new OnchainError("ENS_WRITE_FAILED", "ENSv2 not configured")),
  registerAgentIdentity: () =>
    Promise.reject(new OnchainError("ERC8004_WRITE_FAILED", "ERC-8004 not configured")),
  writeReputation: () =>
    Promise.reject(new OnchainError("ERC8004_WRITE_FAILED", "ERC-8004 not configured")),
  readReputation: () =>
    Promise.reject(new OnchainError("ERC8004_WRITE_FAILED", "ERC-8004 not configured")),
};

// --- public surface (the cross-lane seams) ---
export * from "./money.ts";
export * from "./chains.ts";
export * from "./ens-v2.ts";
export * from "./transfer-auth.ts";
export * from "./payment-intent.ts";
export * from "./server-wallet.ts";
export * from "./viem-server-wallet.ts";
export * from "./privacy.ts";
export * from "./circle-gateway.ts";
export * from "./unlink-transport.ts";
// NOTE: unlink-user.ts (createUserUnlink) is NOT barrel-exported — it imports
// "@unlink-xyz/sdk/admin", a server-only module Turbopack can't bundle into the
// web client (the barrel is reachable from pay-executor → client-root). It has
// no client/server callers via the barrel today; import it directly from
// "./unlink-user.ts" (scripts/tests do). Re-export here only behind a server-
// only subpath if the api ever needs it.
export * from "./cctp.ts";
export * from "./ens.ts";
export * from "./erc8004.ts";
export * from "./verify.ts";
export * from "./errors.ts";
