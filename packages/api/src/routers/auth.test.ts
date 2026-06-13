import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";

// Fresh pglite + migrations per test — slow under concurrent load.
setDefaultTimeout(20_000);
import {
  createAppTokenIssuer,
  createLocalAppTokenVerifier,
} from "../auth/app-token.ts";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";

const ISSUER = "https://superjam.fun";
const logger = createLogger({ level: "silent" });

const harness = async () => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const rateLimiter = createRateLimiter();
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const issuer = await createAppTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
    kid: "sj-test",
    issuer: ISSUER,
  });
  const ctxFor = (token?: string, withIssuer = true) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      issuer: withIssuer ? issuer : undefined,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    });
  return { db, auth, issuer, ctxFor };
};

describe("auth.mintAppToken", () => {
  test("mints a JWKS-verifiable token bound to the app + session user", async () => {
    const { db, auth, issuer, ctxFor } = await harness();
    const owner = await createTestUser(db, { worldVerified: true });
    const app = await createTestApp(db, owner.id);
    const token = await auth.sign({
      dynamicUserId: owner.dynamicUserId!,
      email: owner.email,
    });

    const { token: jwt, exp } = await call(
      appRouter.auth.mintAppToken,
      { appId: app.id },
      { context: ctxFor(token) }
    );
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const claims = await createLocalAppTokenVerifier(issuer.jwks(), ISSUER).verify(
      jwt,
      app.id
    );
    expect(claims.appId).toBe(app.id);
    expect(claims.worldVerified).toBe(true);
    expect(claims.username).toBe(owner.username);
  });

  test("rejects an unknown app", async () => {
    const { db, auth, ctxFor } = await harness();
    const u = await createTestUser(db);
    const token = await auth.sign({
      dynamicUserId: u.dynamicUserId!,
      email: u.email,
    });
    await expect(
      call(
        appRouter.auth.mintAppToken,
        { appId: "app_doesnotexist000000000000" },
        { context: ctxFor(token) }
      )
    ).rejects.toBeInstanceOf(ORPCError);
  });

  test("requires auth", async () => {
    const { ctxFor } = await harness();
    await expect(
      call(
        appRouter.auth.mintAppToken,
        { appId: "app_x" },
        { context: ctxFor() }
      )
    ).rejects.toBeInstanceOf(ORPCError);
  });
});
