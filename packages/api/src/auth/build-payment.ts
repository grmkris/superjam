// Build-payment receipt (§14) — the server's tamper-proof note that THIS user paid
// for THIS build over x402. The x402 settlement has NO public on-chain receipt to
// verify: the user's leg is a PRIVATE Unlink shielded withdraw, and the agent's leg
// is a Circle Gateway transfer **UUID** (async-batched to Circle's ledger, not an
// on-chain Transfer to the agent wallet). So `builds.create` can't verify a hash.
// Instead `builds.payBuildFee` — which executed the settlement for the authenticated
// user — mints this signed token, and `builds.create` trusts it (verifying the
// signature + that the claims match the caller, builder and price). It restores the
// two properties the old EIP-3009 on-chain check had — unforgeable + user-bound —
// without a public receipt.
//
// HMAC-SHA256 over a process secret. `payBuildFee` mints and `create` verifies in the
// SAME server process, so the default per-process random secret needs zero wiring and
// works in tests. Set BUILD_PAYMENT_SECRET to pin it across restarts / multiple
// instances. The Circle UUID rides in the claims and is the replay key (UNIQUE on
// `build.paymentTxHash`).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface BuildPaymentClaims {
  /** The user who paid (the authenticated caller of payBuildFee). */
  userId: string;
  /** The builder this payment is for. */
  builderId: string;
  /** Decimal USDC string the build fee was settled at ("0" for a free build). */
  amountUsdc: string;
  /** True ⇒ the World free build (no settlement); else an x402 paid settlement. */
  free: boolean;
  /** Circle Gateway settlement id — the replay key. Null for a free build. */
  uuid: string | null;
  /** Expiry, unix seconds. */
  exp: number;
}

export interface BuildPaymentSigner {
  /** Sign the claims into a compact `<payload>.<sig>` token. */
  mint(
    claims: Omit<BuildPaymentClaims, "exp"> & { ttlSeconds?: number }
  ): string;
  /** Return the claims iff the signature is valid AND unexpired; else null. */
  verify(token: string): BuildPaymentClaims | null;
}

const b64u = (b: Buffer): string => b.toString("base64url");

export const createBuildPaymentSigner = (secret: string): BuildPaymentSigner => {
  const sign = (payload: string): string =>
    b64u(createHmac("sha256", secret).update(payload).digest());

  return {
    mint({ ttlSeconds = 600, ...rest }) {
      const claims: BuildPaymentClaims = {
        ...rest,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      };
      const payload = b64u(Buffer.from(JSON.stringify(claims)));
      return `${payload}.${sign(payload)}`;
    },

    verify(token) {
      const dot = token.indexOf(".");
      if (dot <= 0) return null;
      const payload = token.slice(0, dot);
      const got = Buffer.from(token.slice(dot + 1));
      const want = Buffer.from(sign(payload));
      if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
      let claims: BuildPaymentClaims;
      try {
        claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        return null;
      }
      if (
        typeof claims.exp !== "number" ||
        claims.exp < Math.floor(Date.now() / 1000)
      ) {
        return null;
      }
      return claims;
    },
  };
};

/** Process-wide signer. BUILD_PAYMENT_SECRET pins it (multi-instance / across
 *  restarts); unset ⇒ a per-process random secret (single-instance dev/prod + tests:
 *  the same process mints in payBuildFee and verifies in create). */
export const buildPaymentSigner = createBuildPaymentSigner(
  process.env.BUILD_PAYMENT_SECRET ?? randomBytes(32).toString("hex")
);
