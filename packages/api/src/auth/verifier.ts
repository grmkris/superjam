// Auth verifier seam (§13). Production verifies Dynamic JWTs against their
// JWKS; tests inject a local-key verifier (test-auth.ts). The rest of the API
// only ever sees the AuthVerifier interface — never jose directly.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface DynamicClaims {
  dynamicUserId: string;
  email: string;
  walletAddress?: string;
}

export interface AuthVerifier {
  verify(token: string): Promise<DynamicClaims>;
}

type VerifiedCredential = {
  format?: string;
  address?: string;
  email?: string;
};

/** Map a verified Dynamic JWT payload onto our claims shape. */
const mapClaims = (payload: Record<string, unknown>): DynamicClaims => {
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("JWT missing sub");
  }
  const creds = Array.isArray(payload.verified_credentials)
    ? (payload.verified_credentials as VerifiedCredential[])
    : [];
  const walletCred = creds.find(
    (c) => c?.format === "blockchain" && typeof c.address === "string"
  );
  const emailCred = creds.find(
    (c) => c?.format === "email" && typeof c.email === "string"
  );
  const email =
    (typeof payload.email === "string" ? payload.email : emailCred?.email) ??
    `${sub}@dynamic.local`;
  return {
    dynamicUserId: sub,
    email,
    walletAddress: walletCred?.address?.toLowerCase(),
  };
};

/** Wrap any jose key resolver as an AuthVerifier. */
export const createJoseVerifier = (
  getKey: JWTVerifyGetKey,
  opts: { issuer?: string; audience?: string } = {}
): AuthVerifier => ({
  async verify(token: string): Promise<DynamicClaims> {
    const { payload } = await jwtVerify(token, getKey, {
      algorithms: ["ES256", "RS256"],
      ...opts,
    });
    return mapClaims(payload as Record<string, unknown>);
  },
});

/** Live verifier against Dynamic's JWKS for an environment (§13). */
export const createDynamicVerifier = (environmentId: string): AuthVerifier => {
  const jwksUrl = new URL(
    `https://app.dynamic.xyz/api/v0/sdk/${environmentId}/.well-known/jwks`
  );
  return createJoseVerifier(createRemoteJWKSet(jwksUrl));
};
