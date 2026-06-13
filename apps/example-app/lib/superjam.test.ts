// Proves the identity handshake end-to-end at the unit level: a token signed
// exactly the way the platform's app-token issuer signs it (ES256, iss/sub/
// username/worldVerified/aud) verifies through this app's verify util, and a
// token minted for another app is rejected. No network, no @superjam/api dep —
// the template is self-contained, like a real external app.
import { describe, expect, test } from "bun:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  SignJWT,
} from "jose";
import { verifySuperJamTokenWith } from "./superjam.ts";

const ISSUER = "https://superjam.fun";

const setup = async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "sj-app";
  jwk.alg = "ES256";
  const jwks: JSONWebKeySet = { keys: [jwk] };
  const mint = (claims: {
    userId: string;
    username: string;
    worldVerified: boolean;
    appId: string;
  }) =>
    new SignJWT({
      username: claims.username,
      worldVerified: claims.worldVerified,
    })
      .setProtectedHeader({ alg: "ES256", kid: "sj-app" })
      .setIssuer(ISSUER)
      .setSubject(claims.userId)
      .setAudience(claims.appId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  return { getKey: createLocalJWKSet(jwks), mint };
};

describe("template verifySuperJamToken", () => {
  test("accepts a platform-shaped token and maps claims", async () => {
    const { getKey, mint } = await setup();
    const token = await mint({
      userId: "usr_1",
      username: "alice",
      worldVerified: true,
      appId: "app_me",
    });
    const user = await verifySuperJamTokenWith(getKey, token, {
      issuer: ISSUER,
      audience: "app_me",
    });
    expect(user).toEqual({
      userId: "usr_1",
      username: "alice",
      worldVerified: true,
      appId: "app_me",
    });
  });

  test("rejects a token issued for a different app (audience binding)", async () => {
    const { getKey, mint } = await setup();
    const token = await mint({
      userId: "usr_1",
      username: "alice",
      worldVerified: false,
      appId: "app_other",
    });
    await expect(
      verifySuperJamTokenWith(getKey, token, {
        issuer: ISSUER,
        audience: "app_me",
      })
    ).rejects.toThrow();
  });
});
