// The CLIENT side of the World/AgentKit "human-backed agent" lane (§14, World prize).
// A user's Claude (via the SuperJam MCP) proves it is backed by a real human — the
// user's Dynamic-DELEGATED wallet, registered in AgentBook on World Chain — by hitting
// the builder's AgentKit-protected `/world` endpoint with an eip191 attestation signed
// by that wallet. A registered human-backed caller gets the FREE trial (a 2xx with no
// settlement header); everyone else falls through to the (parked) Circle payment.
//
// This is the mirror of `x402-resource.ts`'s `freeTrialUses` resource: there the
// builder VERIFIES the human; here the user's agent ATTESTS as the human. The signer
// is the user's delegated wallet (address = `userDelegation.address`), NOT the platform
// server wallet — so the AgentBook lookup resolves to a real human.
//
// SERVER-ONLY (imports `@worldcoin/agentkit`); kept out of the index barrel like
// `x402-resource.ts`, imported via the `@superjam/onchain/agentkit-client` subpath.
import { createAgentkitClient } from "@worldcoin/agentkit";
import { arcTestnet } from "./chains.ts";

/** Arc-testnet CAIP-2 network id (`eip155:5042002`) — the chain the attestation binds to. */
const ARC_X402_NETWORK = `eip155:${arcTestnet.id}` as const;

export interface AgentkitHumanSigner {
  /** The human-backed wallet address (the AgentBook-registered delegated wallet). */
  address: string;
  /** eip191 personal_sign AS that wallet (the Dynamic delegated signer). */
  signMessage: (message: string) => Promise<string>;
}

export interface AgentkitHireResult {
  /** True when the human-backed free trial covered the call (2xx, no settlement). */
  granted: boolean;
  /** The raw HTTP status from the `/world` endpoint (402 ⇒ not recognized as human). */
  status: number;
  /** The endpoint's JSON body (a hire receipt, or the x402 challenge), for diagnostics. */
  body: unknown;
}

/**
 * Call a builder's AgentKit-protected `/world` hire endpoint AS a human-backed agent.
 * Routes through `createAgentkitClient`, which echoes the AgentKit extension (required
 * once the builder declares it) and attaches the eip191 attestation. A registered
 * human-backed caller with remaining free-trial uses gets a 2xx with no settlement
 * header ⇒ `granted: true`. A 402 means the caller wasn't recognized as a registered
 * human (e.g. the wallet isn't in AgentBook yet — see the out-of-band registration step).
 */
export const hireViaAgentkit = async ({
  endpointUrl,
  signer,
}: {
  /** The builder's bare endpoint (from the agent card); `/world` is appended. */
  endpointUrl: string;
  signer: AgentkitHumanSigner;
}): Promise<AgentkitHireResult> => {
  const client = createAgentkitClient({
    signer: {
      address: signer.address,
      chainId: ARC_X402_NETWORK,
      type: "eip191",
      signMessage: signer.signMessage,
    },
    fetch,
  });
  const url = `${endpointUrl.replace(/\/$/, "")}/world`;
  const res = await client.fetch(url, { method: "POST" });
  const settled =
    res.headers.get("x-payment-response") ?? res.headers.get("payment-response");
  const body = await res.json().catch(() => null);
  return { granted: res.ok && !settled, status: res.status, body };
};
