// The BUILDER side of anonymous x402 payments (§3/§14) — the resource server that
// answers `payBuildFee`'s `gateway.pay(endpointUrl)` with an HTTP 402 and settles
// the fee to the builder's own wallet via Circle Gateway (batched, on Arc). This
// is the mirror of `circle-gateway.ts` (the client/payer): there our API SIGNS a
// batched payment; here the builder VERIFIES + SETTLES it. `payTo` = the builder's
// wallet, so the user's private USDC lands directly on the builder in one gas-free
// settlement (the bounty: Dynamic + Unlink + Arc + Circle).
//
// SERVER-ONLY: this file imports `@circle-fin/x402-batching/server` + the
// `@x402/core/server` resource server, so it is deliberately kept OUT of the
// `index.ts` barrel (like `./unlink-user`) — the web bundle imports the barrel and
// must never pull Node server code. apps/builder imports this subpath directly.
//
// Framework-agnostic by design: the handler takes a tiny request shape and returns
// `{ status, headers, body }`, so apps/builder's Hono route is a thin translation.
// The Circle key is OPTIONAL — Circle's x402 verify/settle/supported endpoints take
// the payment authorization itself as proof (the convenience middleware omits auth
// headers too); a Bearer key is attached only when provided.
import { BatchFacilitatorClient, GatewayEvmScheme } from "@circle-fin/x402-batching/server";
import {
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPRequestContext,
  type RoutesConfig,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import { arcTestnet } from "./chains.ts";

/** Circle Gateway facilitator — TESTNET (Arc lives here). The SDK default is the
 *  mainnet host, so it must be passed explicitly. */
const FACILITATOR_TESTNET_URL = "https://gateway-api-testnet.circle.com";
/** Arc-testnet CAIP-2 network id (`eip155:5042002`). */
const ARC_X402_NETWORK = `eip155:${arcTestnet.id}` as const;

export interface X402HireResourceConfig {
  /** The builder's wallet — the x402 `payTo`, where the fee settles. */
  payTo: string;
  /** The build fee as a USDC/dollar amount string (e.g. "0.50"); 1 USDC = $1. */
  priceUsdc: string;
  /** Optional Circle Gateway API key (Bearer). Absent ⇒ no auth headers (the
   *  Circle x402 endpoints accept the payment authorization as proof). */
  circleApiKey?: string;
  /** Override the facilitator host (defaults to the Arc-testnet Gateway). */
  facilitatorUrl?: string;
  /** The protected route, matched against `${method} ${path}`. The build-fee
   *  resource is the builder ROOT, since `payBuildFee` pays the bare endpointUrl
   *  while build dispatch hits `${endpointUrl}/builds`. */
  routePattern?: string;
}

/** The minimal request the handler reads — satisfied by a thin Hono shim. */
export interface X402HireRequest {
  method: string;
  /** Path only (e.g. "/"). */
  path: string;
  /** Full URL (used for the x402 `resource` field). */
  url: string;
  header(name: string): string | undefined;
  /** Parsed JSON body, if any. */
  body?: unknown;
}

/** What the handler returns — the framework writes it verbatim. `body` is JSON. */
export interface X402HireResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type X402HireHandler = (req: X402HireRequest) => Promise<X402HireResponse>;

/**
 * Build the builder's x402 "hire" resource. The returned handler runs the x402
 * handshake for the Circle batching scheme on Arc:
 *   - no `X-PAYMENT` header ⇒ HTTP 402 with batching `PaymentRequirements`
 *     (payTo = builder wallet, amount = price, extra.verifyingContract from the
 *     facilitator's supported kinds).
 *   - valid `X-PAYMENT` ⇒ verify + settle via Circle Gateway, set the
 *     `x-payment-response` header (settlement tx), return 200. The body is just a
 *     hire receipt — the actual build is dispatched separately to `/builds`.
 * The facilitator support fetch (`initialize`) runs once, lazily, on first request.
 */
export const createX402HireResource = (
  cfg: X402HireResourceConfig
): X402HireHandler => {
  const facilitator = new BatchFacilitatorClient({
    url: cfg.facilitatorUrl ?? FACILITATOR_TESTNET_URL,
    ...(cfg.circleApiKey
      ? {
          createAuthHeaders: async () => {
            const h = { Authorization: `Bearer ${cfg.circleApiKey}` };
            return { verify: h, settle: h, supported: h };
          },
        }
      : {}),
  });
  // The batching package bundles its own copy of the `@x402/core` types (a minimal
  // `PaymentPayload`/`PaymentRequirements` subset where `resource.description` is
  // required, not optional). The clients are runtime-compatible, so cast across the
  // (purely nominal) drift at this one boundary.
  const resourceServer = new x402ResourceServer(
    facilitator as unknown as FacilitatorClient
  ).register(ARC_X402_NETWORK, new GatewayEvmScheme() as never);
  const routes: RoutesConfig = {
    [cfg.routePattern ?? "POST /"]: {
      accepts: {
        scheme: "exact", // Circle batching shares the "exact" scheme id
        network: ARC_X402_NETWORK,
        payTo: cfg.payTo,
        price: `$${cfg.priceUsdc}`,
      },
    },
  };
  const httpServer = new x402HTTPResourceServer(resourceServer, routes);

  // Initialize once (fetches facilitator support + validates routes). Don't cache
  // a rejection — let the next request retry if the facilitator was unreachable.
  let ready: Promise<void> | undefined;
  const init = (): Promise<void> => {
    ready ??= httpServer.initialize().catch((err) => {
      ready = undefined;
      throw err;
    });
    return ready;
  };

  return async (req) => {
    await init();
    const adapter: HTTPAdapter = {
      getHeader: (name) => req.header(name),
      getMethod: () => req.method,
      getPath: () => req.path,
      getUrl: () => req.url,
      getAcceptHeader: () => req.header("accept") ?? "",
      getUserAgent: () => req.header("user-agent") ?? "",
      getBody: () => req.body,
    };
    const ctx: HTTPRequestContext = {
      adapter,
      path: req.path,
      method: req.method,
      paymentHeader: req.header("x-payment") ?? undefined,
    };

    const result = await httpServer.processHTTPRequest(ctx);
    if (result.type === "payment-error") {
      // The 402 (or a malformed-payment error) — written verbatim to the client.
      return {
        status: result.response.status,
        headers: result.response.headers,
        body: result.response.body,
      };
    }
    if (result.type === "payment-verified") {
      const settle = await httpServer.processSettlement(
        result.paymentPayload,
        result.paymentRequirements
      );
      if (settle.success) {
        // x-payment-response (settlement tx) rides in settle.headers — the client
        // (wrapFetchWithPayment) decodes it for the on-chain hash.
        return {
          status: 200,
          headers: settle.headers,
          body: { ok: true, paid: true, transaction: settle.transaction },
        };
      }
      return {
        status: settle.response.status,
        headers: settle.response.headers,
        body: settle.response.body,
      };
    }
    // Route matched but no payment required (price 0 / free) — ack.
    return { status: 200, headers: {}, body: { ok: true, paid: false } };
  };
};
