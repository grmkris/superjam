// The concrete UnlinkTransport (§3/§15) — the missing piece that turns payX402
// from a wall into a path. C's privacy.ts defines the `UnlinkTransport` seam and
// `createUnlinkClient` gates `payX402` behind it + `gatewayConfigured`; this file
// supplies the transport. Private tips/faucet pass straight through to Unlink;
// payX402 is the private→x402 bridge: withdraw from the shielded balance, then
// settle the resource via the Circle Gateway leg — one call exercising all four
// slot-3 techs (Dynamic + Unlink + Arc + Circle).
//
// The real `@unlink-xyz/sdk` + `@circle-fin/x402-batching` calls are isolated
// behind injected interfaces (`UnlinkSdk`, `CircleGateway`) so the composition is
// testable offline; the live wiring is filled at the Thursday §23 rehearsal.
import type { Hex } from "viem";
import { type CircleGateway } from "./circle-gateway.ts";
import type { Usdc } from "./money.ts";
import type {
  FaucetArgs,
  PrivateTransferArgs,
  UnlinkTransport,
} from "./privacy.ts";

/** The slice of the Unlink SDK the transport needs. The real shielded-pool calls
 *  are filled at §23 behind this seam (key derivation: `account.fromEthereumSignature`
 *  via Dynamic TSS `personal_sign`, or the mnemonic-in-userStorage path — §3). */
export interface UnlinkSdk {
  privateTransfer(args: PrivateTransferArgs): Promise<{ hash: Hex }>;
  faucetPrivateTokens(args: FaucetArgs): Promise<{ hash: Hex }>;
  /** Withdraw `amount` from the sender's shielded balance so the Circle Gateway
   *  leg can spend it — the "withdraw → pay(url)" private→x402 pattern. */
  withdraw(args: { fromUnlinkAddress: string; amount: Usdc }): Promise<{ hash: Hex }>;
}

export interface UnlinkTransportDeps {
  unlink: UnlinkSdk;
  gateway: CircleGateway;
}

/** Compose the live transport from the two injected SDK seams. */
export const createUnlinkTransport = ({
  unlink,
  gateway,
}: UnlinkTransportDeps): UnlinkTransport => ({
  privateTransfer: (args) => unlink.privateTransfer(args),
  faucetPrivateTokens: (args) => unlink.faucetPrivateTokens(args),
  async payX402({ fromUnlinkAddress, url, amount }) {
    // 1) move the funds out of the shielded pool…
    await unlink.withdraw({ fromUnlinkAddress, amount });
    // 2) …then settle the x402 resource via Circle Gateway (the 4th tech).
    return gateway.pay(url, amount);
  },
});

export interface LiveUnlinkEnv {
  UNLINK_API_KEY?: string;
  UNLINK_APP_ID?: string;
  CIRCLE_GATEWAY_API_KEY?: string;
  ARC_PAYER_EOA_KEY?: string;
  ARC_RPC_URL?: string;
}

/**
 * Build the live UnlinkTransport from env. Returns null until the real SDKs are
 * wired, so payX402 degrades to PAYMENT_REQUIRED and the rest of payments is
 * unaffected (the gated, cut-first posture — §3/§20). The server only treats the
 * Gateway leg as configured when this returns non-null.
 *
 * GROUNDED RECIPE (SDK installed: `@unlink-xyz/sdk@0.3.0-canary.598`; API surface
 * confirmed). The server-side (custodial) wiring on `arc-testnet`:
 *   import { createUnlinkClient, account } from "@unlink-xyz/sdk/client";
 *   const acct = await account.fromEthereumSignature({ signer: serverWalletSigner });
 *   const u = createUnlinkClient({ environment: "arc-testnet", account: acct });
 *   const unlink: UnlinkSdk = {
 *     privateTransfer: (a) => u.transfer({ to: a.toUnlinkAddress, amount: a.amount, token: USDC.arcTestnet.address }),
 *     faucetPrivateTokens: (a) => u.faucet.requestPrivateTokens({ to: a.toUnlinkAddress, amount: a.amount }),
 *     withdraw: (a) => u.withdraw({ to: a.fromUnlinkAddress, amount: a.amount }),
 *   };  // exact param keys: see TransferParams/WithdrawParams/FaucetRequestPrivateTokensParams in dist/client.
 *   return createUnlinkTransport({ unlink, gateway: createCircleGateway({ transport: gwTransport }) });
 * The user-facing private tip is BROWSER-side (Opus P): account.fromMetaMask({
 * provider: dynamicProvider }) → u.transfer(...). NEXT PASS: wire + LIVE-test a
 * real private transfer on Arc (wallet holds 20 USDC + 20 EURC), then flip this
 * from null. Returning null until that live test keeps the public fallback (never
 * ship an unverified @canary shape into the demo path).
 */
export const loadLiveUnlinkTransport = (env: LiveUnlinkEnv): UnlinkTransport | null => {
  const ready = Boolean(
    env.UNLINK_API_KEY && env.CIRCLE_GATEWAY_API_KEY && env.ARC_PAYER_EOA_KEY
  );
  if (!ready) return null;
  // Real SDK composition deferred to the rehearsal (see TODO above).
  return null;
};
