// SuperJam identity for an EXTERNAL, developer-hosted mini-app's backend.
//
// The app runs in a SuperJam iframe and uses @superjam/sdk on the client. To
// authenticate the SuperJam user to THIS app's own backend (its API routes /
// server actions, its Neon DB), the client calls `sdk.auth.getToken()` and
// sends the returned token `Authorization: Bearer`. This module VERIFIES that
// token against SuperJam's published JWKS — the same role the platform plays
// for Dynamic, inverted. No shared secret, no cookies: a stolen env leaks
// nothing (the keys are public; the audience binds the token to this app).
//
// Env (set in Vercel, injected by the builder):
//   SUPERJAM_JWKS_URL  e.g. https://superjam.fun/.well-known/jwks.json
//   SUPERJAM_ISSUER    e.g. https://superjam.fun   (token `iss`)
//   SUPERJAM_APP_ID    this app's id (token `aud`) — rejects tokens for other apps
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

export interface SuperJamUser {
  userId: string;
  username: string;
  worldVerified: boolean;
  appId: string;
}

export interface VerifyOpts {
  issuer: string;
  audience: string;
}

/** Core verify — key resolver injected so it's testable without a network JWKS. */
export const verifySuperJamTokenWith = async (
  getKey: JWTVerifyGetKey,
  token: string,
  opts: VerifyOpts
): Promise<SuperJamUser> => {
  const { payload } = await jwtVerify(token, getKey, {
    algorithms: ["ES256"],
    issuer: opts.issuer,
    audience: opts.audience,
    // platform/app clocks may drift on the 5-min token window
    clockTolerance: 30,
  });
  const userId = typeof payload.sub === "string" ? payload.sub : "";
  const username = typeof payload.username === "string" ? payload.username : "";
  if (!userId || !username) {
    throw new Error("SuperJam token missing sub/username");
  }
  return {
    userId,
    username,
    worldVerified: payload.worldVerified === true,
    appId: opts.audience,
  };
};

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

// Cache the remote key set across invocations (it's fetched + cached by jose).
let remote: JWTVerifyGetKey | undefined;
const jwks = (): JWTVerifyGetKey =>
  (remote ??= createRemoteJWKSet(new URL(env("SUPERJAM_JWKS_URL"))));

/** Verify a token using the app's env (the normal runtime path). */
export const verifySuperJamToken = (token: string): Promise<SuperJamUser> =>
  verifySuperJamTokenWith(jwks(), token, {
    issuer: process.env.SUPERJAM_ISSUER ?? "https://superjam.fun",
    audience: env("SUPERJAM_APP_ID"),
  });

const bearer = (req: Request): string | null => {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
};

/**
 * Resolve the SuperJam user from a request's Bearer token, or null when absent/
 * invalid. Use at the top of every API route / server action that touches
 * user-scoped data — NEVER trust a client-supplied user id.
 */
export const userFromRequest = async (
  req: Request
): Promise<SuperJamUser | null> => {
  const token = bearer(req);
  if (!token) return null;
  try {
    return await verifySuperJamToken(token);
  } catch {
    return null;
  }
};
