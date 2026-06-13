// Circle Gateway leg (§3/§15) — the 4th sponsor tech that completes the slot-3
// nanopayments combo (Dynamic + Unlink + Arc + Circle). It pays an x402-protected
// resource URL from a funded Arc payer EOA via Circle's Gateway. The real
// `@circle-fin/x402-batching` call lives behind the injected `CircleGatewayTransport`
// seam so this wrapper (URL/amount validation, error mapping) is testable offline;
// the live transport is composed at the Thursday §23 rehearsal ("live docs win").
import type { Hex } from "viem";
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
