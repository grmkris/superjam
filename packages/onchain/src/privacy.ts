// The privacy rail (§15) — Unlink shielded transfers on Arc testnet. Injected
// like every other client (DB-free, stateless). The adapter is isomorphic:
// tips call it client-side, top-up's faucet calls it server-side. It DEGRADES
// by design — when `UNLINK_API_KEY` is absent or a call throws, `available` is
// false / the op rejects and the caller silently falls back to the public Base
// Sepolia rail (§15: "the demo never dies"). The fallback orchestration lives in
// the host payments handler (frontend) + `profile.topup` (server), not here —
// this file only knows how to talk to Unlink, or admit it can't.
import type { Hex } from "viem";
import { OnchainError } from "./errors.ts";
import type { Usdc } from "./money.ts";

export interface PrivateTransferArgs {
  /** Sender's `unlink1…` shielded account (resolved from the session user). */
  fromUnlinkAddress: string;
  /** Recipient's shielded account (`@username` → `user.unlinkAddress`). */
  toUnlinkAddress: string;
  amount: Usdc;
}

export interface FaucetArgs {
  toUnlinkAddress: string;
  amount: Usdc;
}

export interface PayX402Args {
  /** Sender's shielded account. */
  fromUnlinkAddress: string;
  /** The x402-protected resource URL to pay for. */
  url: string;
  amount: Usdc;
}

export interface UnlinkClient {
  /** False ⇒ callers must take the public rail. */
  readonly available: boolean;
  /** Private→private shielded transfer, relayed (sender pays no gas, §15). */
  privateTransfer(args: PrivateTransferArgs): Promise<{ hash: Hex }>;
  /** Seed a shielded balance — top-up rung 4 (`faucet.requestPrivateTokens`). */
  faucetPrivateTokens(args: FaucetArgs): Promise<{ hash: Hex }>;
  /** GATED cherry (§3/§9/§14): withdraw → Circle Gateway pay(url). Disabled
   *  unless the Gateway leg is configured. */
  payX402(args: PayX402Args): Promise<{ hash: Hex }>;
}

/** The degraded client — every op rejects so callers fall back to public. Used
 *  whenever `UNLINK_API_KEY` is absent. */
export const nullUnlink: UnlinkClient = {
  available: false,
  privateTransfer() {
    return Promise.reject(
      new OnchainError("CHAIN_UNAVAILABLE", "Unlink privacy rail not configured")
    );
  },
  faucetPrivateTokens() {
    return Promise.reject(
      new OnchainError("CHAIN_UNAVAILABLE", "Unlink privacy rail not configured")
    );
  },
  payX402() {
    return Promise.reject(
      new OnchainError("CHAIN_UNAVAILABLE", "Unlink payX402 not configured")
    );
  },
};

export interface UnlinkConfig {
  apiKey?: string;
  appId?: string;
  /** Gateway leg present ⇒ payX402 enabled; else it rejects (private tips OK). */
  gatewayConfigured?: boolean;
  /** The Unlink SDK seam — injected so the real client is wired at the §23
   *  rehearsal ("live docs win", §0.4) and tests stay offline. */
  transport?: UnlinkTransport;
}

/** What the real Unlink SDK must provide. Kept minimal so the rehearsal wires a
 *  thin shim; the exact request shapes are filled from live Unlink docs. */
export interface UnlinkTransport {
  privateTransfer(args: PrivateTransferArgs): Promise<{ hash: Hex }>;
  faucetPrivateTokens(args: FaucetArgs): Promise<{ hash: Hex }>;
  payX402(args: PayX402Args): Promise<{ hash: Hex }>;
}

/** Build an Unlink client from config. No API key ⇒ the null (degraded) client,
 *  so the public rail is taken transparently. */
export const createUnlinkClient = (config: UnlinkConfig): UnlinkClient => {
  if (!config.apiKey || !config.transport) {
    return nullUnlink;
  }
  const { transport, gatewayConfigured } = config;
  return {
    available: true,
    privateTransfer: (args) => transport.privateTransfer(args),
    faucetPrivateTokens: (args) => transport.faucetPrivateTokens(args),
    payX402: (args) => {
      if (!gatewayConfigured) {
        return Promise.reject(
          new OnchainError("CHAIN_UNAVAILABLE", "Circle Gateway leg not configured")
        );
      }
      return transport.payX402(args);
    },
  };
};
