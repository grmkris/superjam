// Exercises verify-seam-live against a tiny in-test JWKS server (no full-stack
// boot) — proving the script catches the keyless case, validates real keys, and
// verifies a token end-to-end the way an external app backend does.
import { afterAll, describe, expect, test } from "bun:test";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { createAppTokenIssuer } from "../src/auth/app-token.ts";
import { checkJwks, verifyToken } from "./verify-seam-live.ts";

const ISSUER = "https://superjam.fun";

const issuerWithKeys = async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  return createAppTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
    kid: "sj-app",
    issuer: ISSUER,
  });
};

// Serve a JWKS doc on a random port (mirrors apps/server's /.well-known route).
const serveJwks = (jwks: unknown) =>
  Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/.well-known/jwks.json") {
        return Response.json(jwks, {
          headers: { "access-control-allow-origin": "*" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

const servers: Array<{ stop: () => void }> = [];
afterAll(() => servers.forEach((s) => s.stop()));

describe("verify-seam-live", () => {
  test("validates a live JWKS + verifies a token like an external backend", async () => {
    const issuer = await issuerWithKeys();
    const srv = serveJwks(issuer.jwks());
    servers.push(srv);
    const base = `http://localhost:${srv.port}`;

    const jwks = await checkJwks(base);
    expect(jwks.ok).toBe(true);
    expect(jwks.keyCount).toBe(1);
    expect(jwks.kid).toBe("sj-app");

    const { token } = await issuer.mint({
      userId: "usr_1",
      username: "kris",
      worldVerified: true,
      appId: "app_demo",
    });
    const claims = await verifyToken(base, token, "app_demo", ISSUER);
    expect(claims.sub).toBe("usr_1");
    expect(claims.username).toBe("kris");

    // audience-bound: the same token must fail for another app
    await expect(
      verifyToken(base, token, "app_other", ISSUER)
    ).rejects.toThrow();
  });

  test("flags a keyless server (the blank-APP_JWT failure)", async () => {
    const srv = serveJwks({ keys: [] });
    servers.push(srv);
    const check = await checkJwks(`http://localhost:${srv.port}`);
    expect(check.ok).toBe(false);
    expect(check.error).toContain("empty");
  });
});
