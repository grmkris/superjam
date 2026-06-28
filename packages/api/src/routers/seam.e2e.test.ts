// Seam e2e (pivot §1/§3/§4) — proves the SERVER-SIDE identity loop end-to-end,
// in-process, with no infra: a World-verified publisher registers an external
// app → the host mints an identity token for that appId + user → the external
// app's backend verifies it against the published JWKS (audience-bound) → the
// public viewer resolves the entryUrl. This is the "is the seam actually wired
// together" check the unit tests don't give (each hop is unit-tested alone).
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import {
  createAppTokenIssuer,
  createLocalAppTokenVerifier,
} from "../auth/app-token.ts";
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";

// Fresh pglite + migrations per test — slow under concurrent load.
setDefaultTimeout(20_000);

const ISSUER = "https://superjam.fun";
const logger = createLogger({ level: "silent" });

const manifest = {
  name: "Guestbook",
  slug: "guestbook",
  description: "leave a message",
  iconEmoji: "📖",
  category: "social" as const,
  capabilities: ["payments" as const],
};

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
    kid: "sj-app",
    issuer: ISSUER,
  });
  const ctxFor = (token?: string) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      issuer,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    });
  return { db, auth, issuer, ctxFor };
};

describe("seam e2e: register → mint → verify → get", () => {
  test("a registered app's minted token verifies against the published JWKS", async () => {
    const { db, auth, issuer, ctxFor } = await harness();
    const schema = (await import("@superjam/db")).schema;
    await db.insert(schema.user).values({
      dynamicUserId: "dyn_pub",
      email: "pub@test.io",
      username: "pub",
      worldVerified: true,
    });
    const session = await auth.sign({
      dynamicUserId: "dyn_pub",
      email: "pub@test.io",
    });

    // 1) register the external app (the publisher brings a URL)
    const reg = await call(
      appRouter.apps.registerExternal,
      { manifest, entryUrl: "https://guestbook.vercel.app" },
      { context: ctxFor(session) }
    );
    expect(reg.slug).toBe("guestbook");

    // 2) the host mints an identity token for THIS app + the session user
    const { token, exp } = await call(
      appRouter.auth.mintAppToken,
      { appId: reg.id },
      { context: ctxFor(session) }
    );
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // 3) the external app's backend verifies it against the published JWKS
    const verifier = createLocalAppTokenVerifier(issuer.jwks(), ISSUER);
    const claims = await verifier.verify(token, reg.id);
    expect(claims.appId).toBe(reg.id);
    expect(claims.username).toBe("pub");
    expect(claims.worldVerified).toBe(true);

    // 4) the token is audience-bound: it must NOT verify as another app
    const { typeIdGenerator } = await import("@superjam/shared");
    await expect(
      verifier.verify(token, typeIdGenerator("app"))
    ).rejects.toThrow();

    // 5) the public viewer resolves the app's entryUrl + caps for framing
    const view = await call(
      appRouter.apps.get,
      { slug: reg.slug },
      { context: ctxFor() }
    );
    expect(view.entryUrl).toBe("https://guestbook.vercel.app");
    expect(view.entryOrigin).toBe("https://guestbook.vercel.app");
    expect(view.capabilities).toEqual(["payments"]);
  });

  test("a tip resolves appTreasury → the app owner's payout address", async () => {
    const { db, auth, ctxFor } = await harness();
    const schema = (await import("@superjam/db")).schema;
    const owner = "0x1111111111111111111111111111111111111111";
    await db.insert(schema.user).values({
      dynamicUserId: "dyn_t",
      email: "t@test.io",
      username: "t",
      worldVerified: true,
      walletAddress: owner,
    });
    const session = await auth.sign({
      dynamicUserId: "dyn_t",
      email: "t@test.io",
    });
    const reg = await call(
      appRouter.apps.registerExternal,
      { manifest, entryUrl: "https://t.vercel.app" },
      { context: ctxFor(session) }
    );

    const r = await call(
      appRouter.payments.resolveRecipient,
      { to: "appTreasury", appId: reg.id },
      { context: ctxFor(session) }
    );
    expect(r.address.toLowerCase()).toBe(owner);
  });
});
