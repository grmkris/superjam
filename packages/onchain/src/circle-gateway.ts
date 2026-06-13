// Circle Gateway leg (§3/§15) — the 4th sponsor tech that completes the slot-3
// nanopayments combo (Dynamic + Unlink + Arc + Circle). It pays an x402-protected
// resource URL from a funded Arc payer EOA via Circle's Gateway. The real
// `@circle-fin/x402-batching` call lives behind the injected `CircleGatewayTransport`
// seam so this wrapper (URL/amount validation, error mapping) is testable offline;
// the live transport is composed at the Thursday §23 rehearsal ("live docs win").
import type { Hex } from "viem";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme, type ClientEvmSigner } from "@x402/evm";
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

/**
 * The LIVE Circle Gateway transport: an x402 client that pays an x402-protected
 * resource (the agent's build endpoint) on Arc and returns the on-chain settlement
 * hash. The payment authorization is signed by the injected `signer` — the Dynamic
 * SERVER WALLET (no raw payer key). The facilitator is the RESOURCE server's concern
 * (the agent), so the client side needs only the signer + scheme.
 */
export const createLiveCircleGatewayTransport = ({
  signer,
}: {
  signer: ClientEvmSigner;
}): CircleGatewayTransport => {
  const client = new x402Client().register(
    ARC_X402_NETWORK,
    new ExactEvmScheme(signer)
  );
  const paidFetch = wrapFetchWithPayment(fetch, client);
  return {
    async pay({ url }) {
      // POST = "hire this agent to build"; x402 turns the 402 into a signed,
      // settled USDC payment to the agent (payTo), returning the settlement tx.
      const res = await paidFetch(url, { method: "POST" });
      const header = res.headers.get("x-payment-response");
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
