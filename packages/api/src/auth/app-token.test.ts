import { describe, expect, test } from "bun:test";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import {
  AppTokenNotConfiguredError,
  createAppTokenIssuer,
  createLocalAppTokenVerifier,
} from "./app-token.ts";

const ISSUER = "https://superjam.fun";

const issuerWithKeys = async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  return createAppTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
    kid: "sj-test",
    issuer: ISSUER,
  });
};

describe("app-token issuer", () => {
  test("mints a token the published JWKS verifies, claims round-trip", async () => {
    const issuer = await issuerWithKeys();
    const { token, exp } = await issuer.mint({
      userId: "usr_123",
      username: "alice",
      worldVerified: true,
      appId: "app_abc",
    });
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const verifier = createLocalAppTokenVerifier(issuer.jwks(), ISSUER);
    const claims = await verifier.verify(token, "app_abc");
    expect(claims).toEqual({
      userId: "usr_123",
      username: "alice",
      worldVerified: true,
      appId: "app_abc",
    });
  });

  test("rejects a token replayed against a different app (audience binding)", async () => {
    const issuer = await issuerWithKeys();
    const { token } = await issuer.mint({
      userId: "usr_123",
      username: "alice",
      worldVerified: false,
      appId: "app_abc",
    });
    const verifier = createLocalAppTokenVerifier(issuer.jwks(), ISSUER);
    await expect(verifier.verify(token, "app_other")).rejects.toThrow();
  });

  test("rejects a token from a foreign issuer/key", async () => {
    const minted = await issuerWithKeys();
    const { token } = await minted.mint({
      userId: "usr_1",
      username: "a",
      worldVerified: false,
      appId: "app_x",
    });
    // A different issuer's JWKS must not validate it.
    const other = await issuerWithKeys();
    const verifier = createLocalAppTokenVerifier(other.jwks(), ISSUER);
    await expect(verifier.verify(token, "app_x")).rejects.toThrow();
  });

  test("keyless issuer: jwks empty, mint throws typed error", async () => {
    const issuer = await createAppTokenIssuer({ issuer: ISSUER });
    expect(issuer.jwks()).toEqual({ keys: [] });
    await expect(
      issuer.mint({
        userId: "u",
        username: "a",
        worldVerified: false,
        appId: "app_x",
      })
    ).rejects.toBeInstanceOf(AppTokenNotConfiguredError);
  });
});
