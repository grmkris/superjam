// Circle Gateway leg (§3/§15) — the 4th sponsor tech that completes the slot-3
// nanopayments combo (Dynamic + Unlink + Arc + Circle). It pays an x402-protected
// resource URL from a funded Arc payer EOA via Circle's Gateway. The real
// `@circle-fin/x402-batching` call lives behind the injected `CircleGatewayTransport`
// seam so this wrapper (URL/amount validation, error mapping) is testable offline;
// the live transport is composed at the Thursday §23 rehearsal ("live docs win").
import { type Account, type Hex, createPublicClient, http } from "viem";
import { registerBatchScheme } from "@circle-fin/x402-batching/client";
import { createAgentkitClient } from "@worldcoin/agentkit";
import { decodePaymentResponseHeader } from "@x402/core/http";
import {
  ExactEvmScheme,
  type ClientEvmSigner,
  toClientEvmSigner,
} from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { arcTestnet } from "./chains.ts";
import { OnchainError } from "./errors.ts";
import { formatUsdc, type Usdc, ZERO_USDC } from "./money.ts";

/** The low-level Circle Gateway operation the shim needs. The real
 *  `@circle-fin/x402-batching` request shape is filled at §23 and injected here. */
export interface CircleGatewayTransport {
  /** Pay an x402 resource; `amountUsdc` is the 6-dec decimal wire string. */
  pay(args: { url: string; amountUsdc: string }): Promise<{ hash: Hex }>;
}

export interface CircleGateway {
  /** Pay `url` with `amount` USDC; returns the settlement tx hash. */
  pay(url: string, amount: Usdc): Promise<{ hash: Hex }>;
}

export interface CircleGatewayConfig {
  transport: CircleGatewayTransport;
}

/** Wrap a low-level Gateway transport with validation + typed error mapping. */
export const createCircleGateway = ({
  transport,
}: CircleGatewayConfig): CircleGateway => ({
  async pay(url, amount) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new OnchainError("RELAY_FAILED", `Invalid x402 resource URL: ${url}`);
    }
    if (parsed.protocol !== "https:") {
      throw new OnchainError("RELAY_FAILED", "x402 resource URL must be https");
    }
    if (!(amount > ZERO_USDC)) {
      throw new OnchainError("RELAY_FAILED", "x402 amount must be positive");
    }
    try {
      return await transport.pay({ url, amountUsdc: formatUsdc(amount) });
    } catch (err) {
      throw new OnchainError(
        "RELAY_FAILED",
        `Circle Gateway pay failed: ${String(err)}`
      );
    }
  },
});

/** The Arc-testnet x402 network id (`eip155:5042002`). */
const ARC_X402_NETWORK = `eip155:${arcTestnet.id}` as const;

/** Sentinel `hash` returned when Worldcoin AgentKit grants a FREE build (a
 *  human-backed caller's trial) — there is no on-chain settlement to reference. */
export const AGENTKIT_FREE_HASH = "0xagentkitfree" as Hex;

/**
 * Build the x402 client signer from the server wallet's viem `Account` (the
 * Dynamic TSS-MPC account, or the funded fallback key). `toClientEvmSigner`
 * wraps `address` + `signTypedData` into the `ClientEvmSigner` shape the Circle
 * batching scheme signs with; the Arc `publicClient` is attached for the optional
 * read/gas enrichment path. Apps call this so they never depend on `@x402/evm`
 * directly (the dep stays inside @superjam/onchain).
 */
export const createArcX402Signer = (
  account: Account,
  rpcUrl?: string
): ClientEvmSigner =>
  toClientEvmSigner(
    account as never,
    createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) }) as never
  );

/**
 * The LIVE Circle Gateway transport: an x402 client that pays an x402-protected
 * resource (the agent's build endpoint) on Arc and returns the on-chain settlement
 * hash. The payment authorization is signed by the injected `signer` — the Dynamic
 * SERVER WALLET (no raw payer key). The facilitator is the RESOURCE server's concern
 * (the agent), so the client side needs only the signer + scheme.
 *
 * Scheme = Circle Gateway **batching** (`@circle-fin/x402-batching/client`), not plain
 * `exact`: the EIP-3009 authorization is signed against the GatewayWallet escrow
 * contract (`extra.verifyingContract`, supplied by the resource server's enhanced
 * PaymentRequirements) instead of the USDC token, so settlement draws from the payer's
 * Gateway escrow balance. The Circle API key lives on the RESOURCE server (builder),
 * never here — the client only signs. `ExactEvmScheme` is kept as the non-batching
 * fallback so a resource server that doesn't advertise batching still settles.
 */
export const createLiveCircleGatewayTransport = ({
  signer,
  signMessage,
}: {
  signer: ClientEvmSigner;
  /** eip191 personal_sign for the Worldcoin AgentKit client (the same server
   *  wallet). When the builder declares the AgentKit extension, the client MUST
   *  echo it — so requests route through `agentkit.fetch`, which tries the
   *  human-backed free-trial then falls through to the Circle payment. Absent ⇒
   *  plain Circle payment (no AgentKit). */
  signMessage?: (message: string) => Promise<string>;
}): CircleGatewayTransport => {
  // BatchEvmScheme + ExactEvmScheme share scheme id "exact"; registerBatchScheme
  // installs a CompositeEvmScheme that dispatches to batching when the resource
  // server advertises it and to plain-exact otherwise — one registration, no
  // first-wins shadowing.
  const client = new x402Client();
  registerBatchScheme(client, {
    signer,
    networks: [ARC_X402_NETWORK],
    fallbackScheme: new ExactEvmScheme(signer),
  });
  const paidFetch = wrapFetchWithPayment(fetch, client);
  // When AgentKit is in play, route through its client: it echoes the agentkit
  // extension (required when the builder declares it) + tries the free-trial, then
  // falls through to `paidFetch` for the Circle settlement.
  const doFetch: typeof fetch = signMessage
    ? createAgentkitClient({
        signer: {
          address: signer.address,
          chainId: ARC_X402_NETWORK,
          type: "eip191",
          signMessage,
        },
        fetch: paidFetch as typeof fetch,
      }).fetch
    : (paidFetch as typeof fetch);
  return {
    async pay({ url }) {
      // POST = "hire this agent to build"; x402 turns the 402 into a signed,
      // settled USDC payment to the agent (payTo), returning the settlement tx.
      const res = await doFetch(url, { method: "POST" });
      // AgentKit free grant: a 2xx with no settlement header ⇒ the human-backed
      // caller's free trial covered it (no on-chain settlement).
      if (
        res.ok &&
        !res.headers.get("x-payment-response") &&
        !res.headers.get("payment-response")
      ) {
        return { hash: AGENTKIT_FREE_HASH };
      }
      // Circle's batching facilitator returns the settlement under `PAYMENT-RESPONSE`
      // (the @x402 standard is `X-PAYMENT-RESPONSE`) — accept both. The decoded
      // `transaction` is a Circle Gateway transfer id (a UUID; the on-chain batch
      // settles asynchronously), NOT an Arc tx hash.
      const header =
        res.headers.get("x-payment-response") ??
        res.headers.get("payment-response");
      if (!header) {
        throw new OnchainError(
          "RELAY_FAILED",
          "x402: no settlement response header"
        );
      }
      const settlement = decodePaymentResponseHeader(header) as {
        transaction?: Hex;
      };
      if (!settlement.transaction) {
        throw new OnchainError("RELAY_FAILED", "x402: settlement missing tx hash");
      }
      return { hash: settlement.transaction };
    },
  };
};
