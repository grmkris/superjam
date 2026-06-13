// UnlinkService (§23) — the api's per-user private-payments rail. Wraps the proven
// `createUserUnlink` factory (packages/onchain) with a per-user cache so each
// SuperJam user gets ONE shielded Unlink account, server-executed (no per-tx
// popup). The ONE cross-lane seam is `getUserSigner(userId)`: a viem account that
// signs AS the user — a Dynamic *delegated* signer in prod (scoped, revocable;
// see the plan's "Dynamic Delegated Access"), a plain key in tests. This service
// is DB-free (mirrors @superjam/onchain): the api router persists `unlinkAddress`.
import { OnchainError, type Usdc, usdc } from "@superjam/onchain";
// Server-only subpath — it imports "@unlink-xyz/sdk/admin", deliberately kept OUT
// of the @superjam/onchain barrel (the barrel is reachable from the web client).
import { type UserUnlink, createUserUnlink } from "@superjam/onchain/unlink-user";
import type { Hex, LocalAccount } from "viem";

export interface UnlinkServiceDeps {
  /** Unlink admin API key (control-plane: register + auth tokens). */
  apiKey: string;
  /** RPC for the private chain (Arc). */
  rpcUrl?: string;
  /** Per-user EVM signer (signs the derivation message + funds deposits). The
   *  Dynamic delegated signer in prod; a plain `privateKeyToAccount` in tests. */
  getUserSigner: (userId: string) => Promise<LocalAccount>;
}

export interface UnlinkService {
  /** false ⇒ Unlink not configured (the null service); ops reject. */
  readonly available: boolean;
  /** Derive + register the user's shielded account; returns its address. Idempotent. */
  enable(userId: string): Promise<{ unlinkAddress: string }>;
  /** The user's TOTAL shielded USDC balance (the in-app wallet, private-by-default). */
  balance(userId: string): Promise<Usdc>;
  /** Public → private: fund the shielded balance with native USDC. */
  deposit(userId: string, amount: Usdc): Promise<Hex>;
  /** Private → private: a tip / send (the universal nanopayment primitive). */
  transfer(userId: string, toUnlinkAddress: string, amount: Usdc): Promise<Hex>;
  /** Private → public: off-ramp to an EVM address. */
  withdraw(userId: string, toEvmAddress: string, amount: Usdc): Promise<Hex>;
}

/** Compose the live per-user Unlink rail. Caches one `UserUnlink` per userId
 *  (derive+register is network work — do it once per user per process). */
export const createUnlinkService = ({
  apiKey,
  rpcUrl,
  getUserSigner,
}: UnlinkServiceDeps): UnlinkService => {
  const cache = new Map<string, Promise<UserUnlink>>();

  const forUser = (userId: string): Promise<UserUnlink> => {
    let pending = cache.get(userId);
    if (!pending) {
      pending = (async () => {
        const account = await getUserSigner(userId);
        return createUserUnlink({ apiKey, account, rpcUrl });
      })();
      // Don't cache a rejection — let the next call retry the derive/register.
      pending.catch(() => cache.delete(userId));
      cache.set(userId, pending);
    }
    return pending;
  };

  const total = (balances: { amount: string }[]): Usdc =>
    usdc(balances.reduce((acc, b) => acc + BigInt(b.amount), 0n));

  return {
    available: true,
    enable: async (userId) => ({
      unlinkAddress: (await forUser(userId)).unlinkAddress,
    }),
    balance: async (userId) => total(await (await forUser(userId)).getBalances()),
    deposit: async (userId, amount) => (await forUser(userId)).deposit(amount),
    transfer: async (userId, toUnlinkAddress, amount) =>
      (await forUser(userId)).privateTransfer(toUnlinkAddress, amount),
    withdraw: async (userId, toEvmAddress, amount) =>
      (await forUser(userId)).withdraw(toEvmAddress, amount),
  };
};

/** Degraded service — every op rejects with CHAIN_UNAVAILABLE so the api maps it
 *  to a clean error and boot/tests stay green without Unlink config (mirrors
 *  nullOnchain). The server injects the real instance; tests inject a mock. */
export const nullUnlinkService: UnlinkService = {
  available: false,
  enable: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "Unlink not configured")),
  balance: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "Unlink not configured")),
  deposit: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "Unlink not configured")),
  transfer: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "Unlink not configured")),
  withdraw: () =>
    Promise.reject(new OnchainError("CHAIN_UNAVAILABLE", "Unlink not configured")),
};
