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
  encodeAbiParameters,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, worldchain } from "viem/chains";
import { CHAINS, type ChainKey, PUBLIC_CHAIN, USDC } from "./chains.ts";
import {
  type BridgeParams,
  type CctpEndpoint,
  FINALITY_FAST,
  FINALITY_STANDARD,
  createCctp,
} from "./cctp.ts";
import { type EnsV2, type EnsV2Config, createEnsV2 } from "./ens-v2.ts";
import { type GameContract, createGameContract } from "./game.ts";
import { type Erc8004Config, createErc8004 } from "./erc8004.ts";
import { type StakeSlash, createStakeSlash } from "./staking/stake-slash.ts";
import { type AgentBook, createAgentBook, nullAgentBook } from "./agentbook/agent-book.ts";
import { OnchainError } from "./errors.ts";
import { type Usdc, usdc } from "./money.ts";
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
  /** Arc testnet client — the single money chain (verification, balances, relay). */
  publicClient: PublicClient;
  /** The sole privileged payment signer (relay, escrow) on Arc. */
  serverWallet: ServerWallet;
  /** The privacy rail. Defaults to the degraded client (public fallback). */
  unlink?: UnlinkClient;
  /** The identity chain (Sepolia L1) client + signer — ERC-8004 + ENSv2 both live
   *  here, co-located, not on the Arc payment rail. Falls back to
   *  publicClient/serverWallet when unset. */
  identityClient?: PublicClient;
  identityWallet?: ServerWallet;
  /** ERC-8004 reference registries (§16). Absent ⇒ 8004 ops degrade (never fail
   *  a register/review). Signs through the Sepolia identity client+wallet. */
  erc8004?: Erc8004Config;
  /** ENSv2-native adapter — mints `<slug>.superjam.eth` resolvable in STANDARD
   *  ENS tooling (Sepolia L1). Pre-built in createOnchainFromConfig. Absent ⇒ the
   *  v2 mint degrades (build unaffected). */
  ensV2?: EnsV2;
  /** Pre-built CCTP Sepolia→Arc bridge (the platform funding rail). Built in
   *  createOnchainFromConfig from the identity key (funded on BOTH chains). Absent
   *  ⇒ fundViaCctp rejects with CHAIN_UNAVAILABLE. */
  cctp?: { bridge: (p: BridgeParams) => Promise<{ burnTxHash: Hex; mintTxHash: Hex }> };
  /** StakeSlash yield-bearing escrow on Arc (builder stakes earn yield). Absent ⇒
   *  `onchain.stakeSlash` is null and staking degrades (never fails a register). */
  stakeSlash?: StakeSlash;
  /** CctpEscrowHook (Arc) — the CCTP destination receiver that decodes a builder
   *  from hookData and atomically credits its StakeSlash stake (Circle #2). Absent
   *  (with `cctp`) ⇒ `stakeViaCctp` rejects with CHAIN_UNAVAILABLE. */
  cctpEscrowHookAddress?: Address;
  /** World AgentBook reader (human-backed detection, World Chain). Read-only +
   *  public; defaults to the null stub (always-callable, resolves null). */
  agentBook?: AgentBook;
}

/** Platform-funding bridge: burn USDC on Sepolia → mint native USDC on Arc. */
export interface FundViaCctpParams {
  amount: Usdc;
  /** Where the minted Arc USDC lands (usually the platform Arc address, which then
   *  faucets the user's shielded balance). */
  mintRecipient: Address;
  /** Fast Transfer (soft finality, ~min) when true — the default for funding;
   *  false = standard finalized (~13-19 min on Ethereum L1). */
  fast?: boolean;
}

/** Cross-chain stake top-up (Circle #2 flagship): burn USDC on a source chain with
 *  hookData = the builder address → the CctpEscrowHook mints on Arc + credits the
 *  builder's StakeSlash stake atomically. */
export interface StakeViaCctpParams {
  /** The builder wallet whose stake gets credited (encoded into hookData). */
  builder: Address;
  amount: Usdc;
  /** Fast Transfer (~min) by default; false = standard finalized. */
  fast?: boolean;
}

export interface RelayParams {
  chain: ChainKey;
  authorization: TransferAuthMessage;
  signature: Hex;
}

export const createOnchain = ({
  publicClient,
  serverWallet,
  unlink = nullUnlink,
  identityClient,
  identityWallet,
  erc8004,
  ensV2,
  cctp,
  stakeSlash,
  cctpEscrowHookAddress,
  agentBook = nullAgentBook,
}: OnchainDeps) => {
  const clientFor = (chain: ChainKey): PublicClient => {
    // Arc is the only money chain — publicClient is built for PUBLIC_CHAIN.
    if (chain === PUBLIC_CHAIN) return publicClient;
    throw new OnchainError("CHAIN_UNAVAILABLE", `no client for ${chain}`);
  };

  // ERC-8004 lives on Sepolia L1 — the identity chain, co-located with ENSv2 (the
  // canonical reference registries are the same CREATE2 address on every chain).
  // Uses the dedicated Sepolia identity client+signer, not the Arc payment rail.
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

    /** Platform funding rail (§ "Add funds"): burn USDC on Sepolia → CCTP →
     *  mint native USDC on Arc to `mintRecipient`. Fast Transfer by default
     *  (~min). Returns the tx hashes + `minted` (a SAFE lower bound = amount −
     *  maxFee — the recipient receives at least this), so the caller can deposit
     *  exactly what arrived. Rejects if the bridge isn't configured. */
    fundViaCctp: async ({
      amount,
      mintRecipient,
      fast = true,
    }: FundViaCctpParams): Promise<{
      burnTxHash: Hex;
      mintTxHash: Hex;
      minted: Usdc;
    }> => {
      if (!cctp) {
        throw new OnchainError("CHAIN_UNAVAILABLE", "CCTP bridge not configured");
      }
      // Fast transfers require maxFee ≥ the per-transfer fast fee; a 2% cap is
      // ample on testnet (validated live). Standard = no fee.
      const maxFee = fast ? usdc(amount / 50n) : usdc(0n);
      const { burnTxHash, mintTxHash } = await cctp.bridge({
        amount,
        mintRecipient,
        finalityThreshold: fast ? FINALITY_FAST : FINALITY_STANDARD,
        maxFee,
      });
      return { burnTxHash, mintTxHash, minted: usdc(amount - maxFee) };
    },

    /** Cross-chain stake top-up (Circle #2 flagship): burn USDC on the source
     *  chain with `hookData = abi.encode(builder)` and mint to the CctpEscrowHook,
     *  whose `relay` decodes the builder and calls `StakeSlash.depositFor` — the
     *  mint + escrow credit happen atomically on Arc. Fast Transfer by default
     *  (~min). Rejects if the bridge or hook address isn't configured. */
    stakeViaCctp: async ({
      builder,
      amount,
      fast = true,
    }: StakeViaCctpParams): Promise<{
      burnTxHash: Hex;
      mintTxHash: Hex;
      staked: Usdc;
    }> => {
      if (!cctp || !cctpEscrowHookAddress) {
        throw new OnchainError("CHAIN_UNAVAILABLE", "CCTP stake hook not configured");
      }
      const maxFee = fast ? usdc(amount / 50n) : usdc(0n);
      const { burnTxHash, mintTxHash } = await cctp.bridge({
        amount,
        mintRecipient: cctpEscrowHookAddress,
        hookData: encodeAbiParameters([{ type: "address" }], [builder]),
        finalityThreshold: fast ? FINALITY_FAST : FINALITY_STANDARD,
        maxFee,
      });
      return { burnTxHash, mintTxHash, staked: usdc(amount - maxFee) };
    },

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

    // --- StakeSlash (§14, Circle #1) — the yield-bearing builder escrow on Arc.
    //     `null` when unconfigured ⇒ callers `if (onchain.stakeSlash)` and degrade
    //     (a staking failure never blocks agent registration). ---
    stakeSlash: stakeSlash ?? null,

    // --- World AgentBook (§14, World prize) — read-only human-backed detection.
    //     Always present (null stub when unconfigured), so callers can call
    //     `onchain.agentBook.lookupHuman(addr)` without a guard. ---
    agentBook,

    // --- Onchain games (§ builder-deploys-contracts) — read/write a jam's OWN
    //     deployed Arc contract. Reads via the Arc public client, writes via the
    //     server wallet (operator). The api bridge resolves the address+abi from
    //     the app row and stamps the player; this is just the chain I/O. ---
    game: createGameContract(publicClient, serverWallet),
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
  arcRpcUrl?: string;
  unlink?: UnlinkConfig;
  /** ERC-8004 reference registries (§16) — on the Sepolia L1 identity chain. Absent
   *  ⇒ 8004 ops degrade. Signs via the shared Sepolia identity wallet (ensV2SignerKey). */
  erc8004?: Erc8004Config;
  /** ENSv2-native config (SuperjamRegistry on Sepolia L1, §16). Absent ⇒ the v2
   *  mint degrades. Built into the live adapter with the shared Sepolia signer. */
  ensV2?: EnsV2Config;
  /** Sepolia (L1) RPC — the identity chain (ENSv2 + ERC-8004). Required for both. */
  sepoliaRpcUrl?: string;
  /** Dedicated Sepolia identity signer key — MUST own the SuperjamRegistry; also
   *  signs ERC-8004 writes. Distinct from the Dynamic payment wallet; the platform
   *  identity admin key (funded with Sepolia ETH). */
  ensV2SignerKey?: string;
  /** StakeSlash yield-escrow address on Arc (Circle #1). Absent ⇒ staking degrades.
   *  Signs via the Arc server wallet (the Dynamic MPC wallet sponsors seed stakes). */
  stakeSlashAddress?: string;
  /** CctpEscrowHook address on Arc (Circle #2 cross-chain stake). Absent ⇒
   *  `stakeViaCctp` rejects; same-chain top-up + funding are unaffected. */
  cctpEscrowHookAddress?: string;
  /** World Chain (480) RPC for the AgentBook read. Absent ⇒ viem's public default. */
  worldchainRpcUrl?: string;
  /** AgentBook contract override. Absent ⇒ the canonical World Chain deployment. */
  agentBookAddress?: string;
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
  // The single money chain = PUBLIC_CHAIN (Arc). Gas = USDC on Arc, so the server
  // wallet relays/sends paying USDC — no ETH/paymaster.
  const publicRpc = cfg.arcRpcUrl;
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
  // The identity chain = Sepolia (L1): the ENSv2 SuperjamRegistry AND the ERC-8004
  // canonical registries both live here (the 8004 registries are the same CREATE2
  // address on Sepolia + Base Sepolia), so both adapters share ONE Sepolia client +
  // signer — the platform identity admin key (ensV2SignerKey, which owns the
  // SuperjamRegistry + is funded on Sepolia), NOT the Dynamic payment wallet.
  const identityAccount = cfg.ensV2SignerKey
    ? privateKeyToAccount(cfg.ensV2SignerKey as Hex)
    : undefined;
  const identityClient =
    cfg.sepoliaRpcUrl && identityAccount && (cfg.ensV2 || cfg.erc8004)
      ? createPublicClient({ chain: sepolia, transport: http(cfg.sepoliaRpcUrl) })
      : undefined;
  const identityWallet =
    identityClient && identityAccount
      ? createServerWallet({
          account: identityAccount,
          walletClient: createWalletClient({
            account: identityAccount,
            chain: sepolia,
            transport: http(cfg.sepoliaRpcUrl),
          }),
          publicClient: identityClient,
        })
      : undefined;
  const ensV2Adapter =
    cfg.ensV2 && identityClient && identityWallet
      ? createEnsV2(identityClient, identityWallet, cfg.ensV2)
      : undefined;
  // CCTP funding bridge (Sepolia → Arc): the identity key signs BOTH legs — it
  // holds the source USDC on Sepolia (burn) and Arc gas/USDC (mint). Built only
  // when both RPCs + the key are present (prod). The Dynamic payment wallet stays
  // the relay/escrow signer; CCTP funding is a separate platform-operated rail.
  const cctpBridge =
    cfg.sepoliaRpcUrl && cfg.arcRpcUrl && identityAccount
      ? (() => {
          const sepClient =
            identityClient ??
            createPublicClient({ chain: sepolia, transport: http(cfg.sepoliaRpcUrl) });
          const source: CctpEndpoint = {
            chain: "sepolia",
            usdc: USDC.sepolia.address,
            publicClient: sepClient,
            walletClient: createWalletClient({
              account: identityAccount,
              chain: sepolia,
              transport: http(cfg.sepoliaRpcUrl),
            }),
            account: identityAccount,
          };
          const dest: CctpEndpoint = {
            chain: "arcTestnet",
            usdc: USDC.arcTestnet.address,
            publicClient,
            walletClient: createWalletClient({
              account: identityAccount,
              chain: CHAINS.arcTestnet,
              transport: http(cfg.arcRpcUrl),
            }),
            account: identityAccount,
          };
          return createCctp({ source, dest });
        })()
      : undefined;
  // StakeSlash yield-escrow on Arc — the Arc payment rail's client + server wallet
  // (the Dynamic MPC wallet sponsors seed stakes via depositFor). Absent ⇒ null.
  const stakeSlashAdapter = cfg.stakeSlashAddress
    ? createStakeSlash({
        address: cfg.stakeSlashAddress as Address,
        serverWallet,
        publicClient,
      })
    : undefined;
  // AgentBook (human-backed detection) — a dedicated World Chain (480) read client.
  // Read-only + public (no key), so always built; RPC falls back to viem's default.
  const agentBookAdapter = createAgentBook({
    publicClient: createPublicClient({
      chain: worldchain,
      transport: http(cfg.worldchainRpcUrl),
    }) as PublicClient,
    address: cfg.agentBookAddress as Address | undefined,
  });
  return createOnchain({
    publicClient,
    serverWallet,
    unlink: cfg.unlink ? createUnlinkClient(cfg.unlink) : nullUnlink,
    identityClient,
    identityWallet,
    erc8004: cfg.erc8004,
    ensV2: ensV2Adapter,
    cctp: cctpBridge,
    stakeSlash: stakeSlashAdapter,
    cctpEscrowHookAddress: cfg.cctpEscrowHookAddress as Address | undefined,
    agentBook: agentBookAdapter,
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
  fundViaCctp: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  stakeViaCctp: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  mintV2Subname: () =>
    Promise.reject(new OnchainError("ENS_WRITE_FAILED", "ENSv2 not configured")),
  ensV2Addr: () =>
    Promise.reject(new OnchainError("ENS_WRITE_FAILED", "ENSv2 not configured")),
  stakeSlash: null,
  agentBook: nullAgentBook,
  game: {
    read: () =>
      Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
    write: () =>
      Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  },
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
export * from "./game.ts";
export * from "./transfer-auth.ts";
export * from "./payment-intent.ts";
export * from "./server-wallet.ts";
export * from "./viem-server-wallet.ts";
export * from "./privacy.ts";
export * from "./circle-gateway.ts";
export * from "./unlink-transport.ts";
// Web-safe Unlink constants (CANON_UNLINK_MESSAGE etc.) — the browser bootstrap
// step imports these; the createUserUnlink module itself stays un-barreled (below).
export * from "./unlink-constants.ts";
// NOTE: unlink-user.ts (createUserUnlink) is NOT barrel-exported — it imports
// "@unlink-xyz/sdk/admin", a server-only module Turbopack can't bundle into the
// web client (the barrel is reachable from pay-executor → client-root). It has
// no client/server callers via the barrel today; import it directly from
// "./unlink-user.ts" (scripts/tests do). Re-export here only behind a server-
// only subpath if the api ever needs it.
export * from "./erc8004.ts";
export * from "./agentbook/agent-book.ts";
export * from "./cctp.ts";
export * from "./verify.ts";
export * from "./errors.ts";
