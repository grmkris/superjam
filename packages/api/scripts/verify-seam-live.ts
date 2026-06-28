#!/usr/bin/env bun
// verify-seam-live.ts — verify a LIVE SuperJam server's identity seam from the
// perspective of an EXTERNAL app's backend, using ONLY jose (exactly what a
// dev-hosted mini-app does). The "harness against a live server" — it catches
// what the in-process pglite test can't: a keyless/blank APP_JWT env, a broken
// or CORS-blocked JWKS route, an issuer/audience mismatch.
//
//   bun packages/api/scripts/verify-seam-live.ts <baseUrl> [token] [appId] [issuer]
//
// Examples:
//   bun packages/api/scripts/verify-seam-live.ts https://dev.superjam.fun
//   bun packages/api/scripts/verify-seam-live.ts https://dev.superjam.fun <jwt> app_123
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface JwksCheck {
  ok: boolean;
  keyCount: number;
  alg?: string;
  kid?: string;
  error?: string;
}

/** Fetch + validate the published JWKS — the #1 live failure is an empty set
 *  (APP_JWT_* not configured → the issuer is keyless). */
export async function checkJwks(baseUrl: string): Promise<JwksCheck> {
  try {
    const url = new URL("/.well-known/jwks.json", baseUrl).toString();
    const res = await fetch(url);
    if (!res.ok) return { ok: false, keyCount: 0, error: `HTTP ${res.status}` };
    const body = (await res.json()) as {
      keys?: Array<{ alg?: string; kid?: string; kty?: string }>;
    };
    const keys = body.keys ?? [];
    if (keys.length === 0) {
      return {
        ok: false,
        keyCount: 0,
        error: "JWKS is empty — APP_JWT_* not configured on the server",
      };
    }
    const k = keys[0]!;
    return {
      ok: k.kty === "EC" && (k.alg === undefined || k.alg === "ES256"),
      keyCount: keys.length,
      alg: k.alg,
      kid: k.kid,
    };
  } catch (e) {
    return { ok: false, keyCount: 0, error: String(e) };
  }
}

export interface AppCheck {
  ok: boolean;
  name?: string;
  slug?: string;
  capabilities?: string[];
  framable?: boolean;
  error?: string;
}

/** Verify a DEPLOYED external app is demo-ready: it serves a valid SuperJam
 *  manifest AND allows the host to frame it. The #1 silent demo failure is an
 *  app that refuses to be framed (X-Frame-Options / a frame-ancestors that
 *  excludes superjam) → a blank iframe with only a console error. */
export async function checkApp(appUrl: string): Promise<AppCheck> {
  try {
    const mres = await fetch(
      new URL("/.well-known/superjam.json", appUrl).toString()
    );
    if (!mres.ok) return { ok: false, error: `manifest HTTP ${mres.status}` };
    const m = (await mres.json()) as {
      name?: string;
      slug?: string;
      capabilities?: string[];
    };
    if (!m.slug) return { ok: false, error: "manifest missing slug" };

    // framing: a blocking X-Frame-Options, or a frame-ancestors that names
    // origins but not superjam, means the host can't frame it.
    const pres = await fetch(appUrl);
    const xfo = (pres.headers.get("x-frame-options") ?? "").toLowerCase();
    const csp = (pres.headers.get("content-security-policy") ?? "").toLowerCase();
    const fa = csp.includes("frame-ancestors");
    const framable =
      !(xfo.includes("deny") || xfo.includes("sameorigin")) &&
      (!fa || csp.includes("superjam"));

    return {
      ok: Boolean(m.slug) && framable,
      name: m.name,
      slug: m.slug,
      capabilities: m.capabilities,
      framable,
      error: framable ? undefined : "app refuses framing (X-Frame-Options / CSP)",
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Verify an identity token exactly as an external app's backend would. */
export async function verifyToken(
  baseUrl: string,
  token: string,
  appId: string,
  issuer: string
): Promise<JWTPayload> {
  const getKey = createRemoteJWKSet(new URL("/.well-known/jwks.json", baseUrl));
  const { payload } = await jwtVerify(token, getKey, {
    algorithms: ["ES256"],
    issuer,
    audience: appId,
    clockTolerance: 30,
  });
  return payload;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  // `--app <url>`: verify a deployed external app (manifest + framing).
  const appFlag = argv.indexOf("--app");
  if (appFlag !== -1) {
    const appUrl = argv[appFlag + 1];
    if (!appUrl) {
      console.error("usage: --app <appUrl>");
      process.exit(2);
    }
    const a = await checkApp(appUrl);
    console.log(
      `APP @ ${appUrl}: ${a.ok ? "OK ✓" : "FAIL ✗"}` +
        (a.slug ? ` slug=${a.slug}` : "") +
        (a.name ? ` name="${a.name}"` : "") +
        (a.capabilities ? ` caps=[${a.capabilities.join(",")}]` : "") +
        ` framable=${a.framable}` +
        (a.error ? ` (${a.error})` : "")
    );
    process.exit(a.ok ? 0 : 1);
  }

  const [baseUrl, token, appId, issuerArg] = argv;
  if (!baseUrl) {
    console.error(
      "usage: bun packages/api/scripts/verify-seam-live.ts <baseUrl> [token] [appId] [issuer]"
    );
    process.exit(2);
  }
  const jwks = await checkJwks(baseUrl);
  console.log(
    `JWKS @ ${baseUrl}: ${jwks.ok ? "OK ✓" : "FAIL ✗"} — ${jwks.keyCount} key(s)` +
      (jwks.alg ? ` alg=${jwks.alg}` : "") +
      (jwks.kid ? ` kid=${jwks.kid}` : "") +
      (jwks.error ? ` (${jwks.error})` : "")
  );
  if (!jwks.ok) process.exit(1);

  if (token && appId) {
    try {
      const issuer = issuerArg ?? new URL(baseUrl).origin;
      const c = await verifyToken(baseUrl, token, appId, issuer);
      console.log(
        `token verify: OK ✓ — ${JSON.stringify({
          sub: c.sub,
          username: c.username,
          worldVerified: c.worldVerified,
          aud: c.aud,
        })}`
      );
    } catch (e) {
      console.log(`token verify: FAIL ✗ — ${String(e)}`);
      process.exit(1);
    }
  } else {
    console.log(
      "(pass [token] [appId] to also verify a real mint — from the host's sdk.auth.getToken())"
    );
  }
}
