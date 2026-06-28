#!/usr/bin/env bun
// Prove the LIVE deployed app verifies a real platform token end-to-end:
// mint a token locally (same APP_JWT key dev serves in its JWKS) for the
// registered appId, then call the deployed app's own /api/me — which fetches
// dev's JWKS and verifies aud+iss exactly as an external backend must.
import { createAppTokenIssuer } from "../src/auth/app-token.ts";
import { verifyToken } from "./verify-seam-live.ts";

const APP_ID = process.env.APP_ID ?? "app_01kv09wp8vfzs9t0a1aswf1pa3";
const APP_URL = process.env.APP_URL ?? "https://sj-guestbook.vercel.app";
const DEV = "https://dev.superjam.fun";

const issuer = await createAppTokenIssuer({
  privateKeyPem: process.env.APP_JWT_PRIVATE_KEY!,
  publicKeyPem: process.env.APP_JWT_PUBLIC_KEY!,
  kid: process.env.APP_JWT_KID!,
  issuer: DEV, // SERVICE_URLS.dev.web — the iss the real server uses
});
const { token } = await issuer.mint({
  userId: "usr_probe",
  username: "kristjangrm1",
  worldVerified: false,
  appId: APP_ID,
});

// 1) does our local mint verify against DEV's published JWKS? (key-match proof)
try {
  const c = await verifyToken(DEV, token, APP_ID, DEV);
  console.log(`✓ local mint verifies vs dev JWKS — sub=${c.sub} aud=${c.aud}`);
} catch (e) {
  console.log(`✗ local mint does NOT verify vs dev JWKS: ${String(e).slice(0, 120)}`);
  console.log("  (local APP_JWT key != the one deployed on Railway — expected if keys differ)");
}

// 2) the real test: the DEPLOYED app's own backend verifies it.
const res = await fetch(`${APP_URL}/api/me`, {
  headers: { authorization: `Bearer ${token}` },
});
const body = await res.text();
console.log(`\n${APP_URL}/api/me → HTTP ${res.status}`);
console.log(body);
console.log(
  res.ok
    ? "\n✓ END-TO-END: deployed app fetched dev JWKS, verified the platform token (aud+iss), returned the identity."
    : "\n✗ deployed app rejected the token — check SUPERJAM_APP_ID/ISSUER/JWKS_URL on Vercel."
);
