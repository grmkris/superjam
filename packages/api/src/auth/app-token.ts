// Platform identity-token issuer (pivot §1). The mirror image of verifier.ts:
// where that VERIFIES Dynamic's user-login JWTs, this MINTS short-lived
// SuperJam identity tokens that an EXTERNAL, developer-hosted mini-app's own
// backend can verify against our published JWKS — so the app can trust "this
// request is World-verified user X" without trusting the iframe client.
//
// Trust boundary: the private key lives ONLY on the platform server. Minting is
// always server-side (a host-relayed oRPC call); the browser never holds it.
// Tokens are audience-bound to a single appId so app A can't replay a user's
// token against app B.
//
// Keyless-safe: with no key env configured, jwks() returns no keys and mint()
// throws AppTokenNotConfiguredError — boot/typecheck stay green (the same
// "optional in schema, assert at use" doctrine as the Dynamic block in env.ts).
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type JSONWebKeySet,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";

const ALG = "ES256";
/** Identity tokens are short-lived; the SDK re-fetches via auth.getToken. */
export const APP_TOKEN_TTL_SECONDS = 300;

/** The identity a mini-app's backend learns about the current SuperJam user. */
export interface AppIdentityClaims {
  userId: string;
  username: string;
  worldVerified: boolean;
  appId: string;
}

export interface MintParams {
  userId: string;
  username: string;
  worldVerified: boolean;
  appId: string;
}

export interface AppTokenIssuer {
  /** Mint a 5-min identity token bound to `appId` (aud). */
  mint(params: MintParams): Promise<{ token: string; exp: number }>;
  /** Public JWKS for /.well-known/jwks.json (array form, for rotation). */
  jwks(): JSONWebKeySet;
}

export class AppTokenNotConfiguredError extends Error {
  constructor() {
    super("App identity token signing is not configured (APP_JWT_* unset).");
    this.name = "AppTokenNotConfiguredError";
  }
}

/**
 * The keyless issuer — mint rejects, jwks is empty. The default in the oRPC
 * context so every existing createContext caller (and a key-less local/test
 * server) keeps working; only mintAppToken on a keyless context fails.
 */
export const nullAppTokenIssuer: AppTokenIssuer = {
  mint() {
    return Promise.reject(new AppTokenNotConfiguredError());
  },
  jwks() {
    return { keys: [] };
  },
};

export interface AppTokenIssuerOpts {
  /** ES256 private key, PKCS8 PEM. Absent ⇒ keyless (mint throws). */
  privateKeyPem?: string;
  /** ES256 public key, SPKI PEM. Used to publish the JWKS. */
  publicKeyPem?: string;
  /** Stable key id, published in the JWK + token header for rotation. */
  kid?: string;
  /** Token issuer (the platform web origin). */
  issuer: string;
}

/**
 * Build the issuer. Async because key import is async (mirrors createTestAuth).
 * When private/public PEMs are both present it can mint + publish; otherwise it
 * degrades to the keyless no-op so a key-less environment still boots.
 */
export const createAppTokenIssuer = async (
  opts: AppTokenIssuerOpts
): Promise<AppTokenIssuer> => {
  const { privateKeyPem, publicKeyPem, kid = "sj-app", issuer } = opts;

  if (!privateKeyPem || !publicKeyPem) {
    return nullAppTokenIssuer;
  }

  const privateKey = await importPKCS8(privateKeyPem, ALG);
  const publicJwk: JWK = await exportJWK(await importSPKI(publicKeyPem, ALG));
  publicJwk.kid = kid;
  publicJwk.alg = ALG;
  publicJwk.use = "sig";
  const keys: JSONWebKeySet = { keys: [publicJwk] };

  return {
    async mint({ userId, username, worldVerified, appId }) {
      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + APP_TOKEN_TTL_SECONDS;
      const token = await new SignJWT({ username, worldVerified })
        .setProtectedHeader({ alg: ALG, kid })
        .setIssuer(issuer)
        .setSubject(userId)
        .setAudience(appId)
        .setIssuedAt(nowSec)
        .setExpirationTime(exp)
        .sign(privateKey);
      return { token, exp };
    },
    jwks() {
      return keys;
    },
  };
};

export interface AppTokenVerifier {
  /** Verify a token issued for `audience` (the verifying app's id). */
  verify(token: string, audience: string): Promise<AppIdentityClaims>;
}

/** Wrap any jose key resolver as an identity-token verifier (mirrors verifier.ts). */
export const createAppTokenVerifier = (
  getKey: JWTVerifyGetKey,
  opts: { issuer: string }
): AppTokenVerifier => ({
  async verify(token: string, audience: string): Promise<AppIdentityClaims> {
    const { payload } = await jwtVerify(token, getKey, {
      algorithms: [ALG],
      issuer: opts.issuer,
      audience,
      // Tolerate small platform/app clock drift on the 5-min window.
      clockTolerance: 30,
    });
    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const username = typeof payload.username === "string" ? payload.username : "";
    if (!userId || !username) {
      throw new Error("App token missing sub/username");
    }
    return {
      userId,
      username,
      worldVerified: payload.worldVerified === true,
      appId: audience,
    };
  },
});

/** Live verifier an external app backend would use against our published JWKS. */
export const createRemoteAppTokenVerifier = (
  jwksUrl: string,
  issuer: string
): AppTokenVerifier =>
  createAppTokenVerifier(createRemoteJWKSet(new URL(jwksUrl)), { issuer });

/** In-process verifier from a JWKS document (tests; mirrors createLocalJWKSet). */
export const createLocalAppTokenVerifier = (
  jwks: JSONWebKeySet,
  issuer: string
): AppTokenVerifier =>
  createAppTokenVerifier(createLocalJWKSet(jwks), { issuer });
