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
import { createGameContract } from "./game.ts";
import { OnchainError } from "./errors.ts";
import type { Usdc } from "./money.ts";
import { createServerWallet } from "./viem-server-wallet.ts";
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
  /** The identity chain (Sepolia L1) client + signer — ERC-8004 + ENSv2 both live
   *  here, co-located, not on the Arc payment rail. Falls back to
   *  publicClient/serverWallet when unset. */
  identityClient?: PublicClient;
  identityWallet?: ServerWallet;
  /** ENSv2-native adapter — mints `<slug>.superjam.eth` resolvable in STANDARD
   *  ENS tooling (Sepolia L1). Pre-built in createOnchainFromConfig. Absent ⇒ the
   *  v2 mint degrades (build unaffected). */
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
  ensV2,
}: OnchainDeps) => {
  const clientFor = (chain: ChainKey): PublicClient => {
    // Arc is the only money chain — publicClient is built for PUBLIC_CHAIN.
    if (chain === PUBLIC_CHAIN) return publicClient;
    throw new OnchainError("CHAIN_UNAVAILABLE", `no client for ${chain}`);
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
  /** ENSv2-native config (SuperjamRegistry on Sepolia L1, §16). Absent ⇒ the v2
   *  mint degrades. Built into the live adapter with the shared Sepolia signer. */
  ensV2?: EnsV2Config;
  /** Sepolia (L1) RPC — the identity chain (ENSv2). */
  sepoliaRpcUrl?: string;
  /** Dedicated Sepolia identity signer key — MUST own the SuperjamRegistry. Distinct
   *  from the Dynamic payment wallet; the platform identity admin key (funded with
   *  Sepolia ETH). */
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
    cfg.sepoliaRpcUrl && identityAccount && cfg.ensV2
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
  return createOnchain({
    publicClient,
    serverWallet,
    ensV2: ensV2Adapter,
  });
};

/** Build/test-only seam — NOT a runtime fallback. Every chain op rejects with
 *  CHAIN_UNAVAILABLE so the secret-less CI/image build (SKIP_ENV_VALIDATION) and
 *  unit tests stay green without creds (mirrors nullUnlink / nullAppTokenIssuer).
 *  Any real deploy injects the live instance; tests inject a mock. */
export const nullOnchain: Onchain = {
  serverAddress: "0x0000000000000000000000000000000000000000",
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
  game: {
    read: () =>
      Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
    write: () =>
      Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "onchain not configured")),
  },
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
export * from "./verify.ts";
export * from "./errors.ts";
