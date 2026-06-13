// Test auth seam (§13): a local ES256 keypair backs a JWKS verifier AND a
// signer, so tests mint their own valid Dynamic-shaped JWTs without touching
// the network. Production uses createDynamicVerifier; tests inject this.
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { type AuthVerifier, createJoseVerifier } from "./verifier.ts";

export interface TestClaims {
  dynamicUserId: string;
  email: string;
  walletAddress?: string;
}

export interface TestAuth {
  verifier: AuthVerifier;
  sign(claims: TestClaims): Promise<string>;
}

export const createTestAuth = async (): Promise<TestAuth> => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "ES256";
  const verifier = createJoseVerifier(createLocalJWKSet({ keys: [jwk] }));

  const sign = (claims: TestClaims): Promise<string> => {
    const credentials: Record<string, unknown>[] = [
      { format: "email", email: claims.email },
    ];
    if (claims.walletAddress) {
      credentials.push({ format: "blockchain", address: claims.walletAddress });
    }
    return new SignJWT({
      email: claims.email,
      verified_credentials: credentials,
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(claims.dynamicUserId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  };

  return { verifier, sign };
};
