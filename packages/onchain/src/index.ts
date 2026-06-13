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
  /** The identity chain (Sepolia) client + signer — ERC-8004 + ENSv2 both live
   *  here, co-located, not on the Arc public rail. Falls back to
   *  publicClient/serverWallet when unset. */
  identityClient?: PublicClient;
  identityWallet?: ServerWallet;
  /** ERC-8004 reference registries (§16). Absent ⇒ 8004 ops degrade (never fail
   *  a register/review). Signs through the Sepolia identity client+wallet. */
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
  identityClient,
  identityWallet,
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

  // ERC-8004 lives on Sepolia — the identity chain, co-located with ENSv2 (the
  // canonical reference registries are the same CREATE2 address on Sepolia + Base
  // Sepolia). Uses the dedicated Sepolia identity client+signer, not the Arc rail.
  // Absent config ⇒ ops throw so callers degrade (a register/feedback failure
  // never fails the agent register / the review).
  const erc8004Adapter = erc8004
    ? createErc8004(identityClient ?? publicClient, identityWallet ?? serverWallet, erc8004)
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

    // --- ENS (§16) — the SINGLE naming path: ENSv2-native `<label>.superjam.eth`,
    //     resolvable in standard ENS tooling (viem/ethers/app.ens.domains). Used
    //     for apps, users, AND agents. Durin (the old L2 registry) was removed.
    //     Degrade-safe: writes throw → callers try/catch → name just omitted. ---
    /** Mint `<label>.superjam.eth` natively in ENSv2 (Sepolia L1) -> owner. */
    mintV2Subname: (params: Parameters<NonNullable<typeof ensV2>["mintSubname"]>[0]) =>
      requireEnsV2().mintSubname(params),
    /** Read the on-chain address record for `<label>.superjam.eth` (catalog /
     *  backfill idempotency check). */
    ensV2Addr: (label: string) => requireEnsV2().addr(label),

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
  /** Pre-built ERC-8004 signer on Base Sepolia — defaults to the Dynamic wallet. */
  baseSepoliaWallet?: ServerWallet;
  baseSepoliaRpcUrl?: string;
  arcRpcUrl?: string;
  unlink?: UnlinkConfig;
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
  // Treat an empty/non-hex key as ABSENT. Railway sets SERVER_WALLET_PRIVATE_KEY=""
  // (the Dynamic TSS wallet is the real signer) — `privateKeyToAccount("")` throws,
  // so a non-0x string must NEVER reach createServerWalletFromKey. Use `rawKey`
  // (not the raw cfg field) for every key-based wallet fallback below.
  const rawKey =
    cfg.serverWalletPrivateKey && cfg.serverWalletPrivateKey.startsWith("0x")
      ? (cfg.serverWalletPrivateKey as Hex)
      : undefined;
  if (!cfg.serverWallet && !rawKey) return null;
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
      privateKey: rawKey as Hex, // guaranteed defined here (guard above)
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
  // The identity chain = Sepolia (L1): the ENSv2 SuperjamRegistry AND the ERC-8004
  // canonical registries both live here (the 8004 registries are the same CREATE2
  // address on Sepolia + Base Sepolia), so both adapters share ONE Sepolia client +
  // signer — the platform identity admin key (ensV2SignerKey, which owns the
  // SuperjamRegistry + is funded on Sepolia), NOT the Dynamic payment wallet.
  const identityClient =
    cfg.sepoliaRpcUrl && cfg.ensV2SignerKey && (cfg.ensV2 || cfg.erc8004)
      ? createPublicClient({ chain: sepolia, transport: http(cfg.sepoliaRpcUrl) })
      : undefined;
  const identityWallet =
    identityClient && cfg.ensV2SignerKey
      ? (() => {
          const account = privateKeyToAccount(cfg.ensV2SignerKey as Hex);
          return createServerWallet({
            account,
            walletClient: createWalletClient({
              account,
              chain: sepolia,
              transport: http(cfg.sepoliaRpcUrl),
            }),
            publicClient: identityClient,
          });
        })()
      : undefined;
  const ensV2Adapter =
    cfg.ensV2 && identityClient && identityWallet
      ? createEnsV2(identityClient, identityWallet, cfg.ensV2)
      : undefined;
  return createOnchain({
    publicClient,
    serverWallet,
    arcClient,
    unlink: cfg.unlink ? createUnlinkClient(cfg.unlink) : nullUnlink,
    identityClient,
    identityWallet,
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
  mintV2Subname: () =>
    Promise.reject(new OnchainError("ENS_WRITE_FAILED", "ENSv2 not configured")),
  ensV2Addr: () =>
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
export * from "./erc8004.ts";
export * from "./verify.ts";
export * from "./errors.ts";
