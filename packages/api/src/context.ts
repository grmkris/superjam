// oRPC request context (§12). Long-lived deps (db, logger, auth verifier) are
// injected once; `headers` is per-request. The protected middleware reads the
// bearer token from `headers` and adds `user`.
import type { Database } from "@superjam/db";
import type { Logger } from "@superjam/logger";
import {
  type Onchain,
  type TransferAuthTypedData,
  nullOnchain,
} from "@superjam/onchain";
import type { Address, Hex } from "viem";
import { type AppTokenIssuer, nullAppTokenIssuer } from "./auth/app-token.ts";
import type { AuthVerifier } from "./auth/verifier.ts";
import { type PotOracle, nullOracle } from "./lib/oracle.ts";
import type { RateLimiter } from "./lib/rate-limit.ts";
import { type ObjectStore, nullObjectStore } from "./services/object-store.ts";

/** Server-side delegated signer (Dynamic Delegated Access, §23). Signs the EIP-712
 *  EIP-3009 transfer authorization AS the user via their approved MPC key share —
 *  no browser, no per-tx popup. Concrete impl lives in apps/server (Node SDK);
 *  absent here ⇒ delegated-pay paths reject with a clear "delegate first". */
export interface DelegatedSigner {
  /** Does this user have an active delegation on file? */
  hasDelegation(userId: string): Promise<boolean>;
  /** Produce the user's EIP-712 signature over a transfer authorization. */
  signTransferAuth(userId: string, typed: TransferAuthTypedData): Promise<Hex>;
}

export interface ApiContext {
  db: Database;
  logger: Logger;
  auth: AuthVerifier;
  rateLimiter: RateLimiter;
  /** Mints identity tokens for external apps (pivot §1). Keyless by default. */
  issuer: AppTokenIssuer;
  /** Chain adapter (payments/pots/ENS, §15/§16). Degraded by default. */
  onchain: Onchain;
  /** AI pot-resolution oracle (§9). Disabled by default. */
  oracle: PotOracle;
  /** Blob storage for uploads/bundles (§17, S3/Railway bucket). Degraded by default. */
  objectStore: ObjectStore;
  /** The house builder's dispatch endpoint + token (§11) — builds.create POSTs the
   *  spec here. Set from BUILDER_URL/BUILDER_TOKEN; absent ⇒ builds.create rejects. */
  builderEndpoint?: string;
  builderToken?: string;
  /** The platform's JWKS url for THIS env (derived from APP_ENV/SERVICE_URLS) — sent
   *  per build so the builder bakes the RIGHT env's JWKS into the jam (one shared box
   *  can serve dev + prod). Absent ⇒ the builder falls back to its own env default. */
  jwksUrl?: string;
  /** Platform treasury — recipient of the publish fee (§15). */
  treasuryAddress?: Address;
  /** Server-signs-as-user (Dynamic Delegated Access). Absent ⇒ delegated paths reject. */
  delegatedSigner?: DelegatedSigner;
  headers: Headers;
}

export interface CreateContextDeps {
  db: Database;
  logger: Logger;
  auth: AuthVerifier;
  rateLimiter: RateLimiter;
  /** Optional — defaults to the keyless issuer so existing callers/tests work. */
  issuer?: AppTokenIssuer;
  /** Optional — defaults to the degraded onchain so boot/tests stay green. */
  onchain?: Onchain;
  /** Optional — defaults to the null oracle (AI-resolve unavailable). */
  oracle?: PotOracle;
  /** Optional — defaults to the degraded object store (uploads/presign reject). */
  objectStore?: ObjectStore;
  /** The house builder dispatch creds (BUILDER_URL/BUILDER_TOKEN). Absent ⇒ builds reject. */
  builderEndpoint?: string;
  builderToken?: string;
  /** This env's JWKS url (SERVICE_URLS[APP_ENV].web + /.well-known/jwks.json) — baked per build. */
  jwksUrl?: string;
  treasuryAddress?: Address;
  /** Optional — absent ⇒ delegated-pay paths reject with "delegate first". */
  delegatedSigner?: DelegatedSigner;
  headers: Headers;
}

export const createContext = (deps: CreateContextDeps): ApiContext => {
  const onchain = deps.onchain ?? nullOnchain;
  return {
    db: deps.db,
    logger: deps.logger,
    auth: deps.auth,
    rateLimiter: deps.rateLimiter,
    issuer: deps.issuer ?? nullAppTokenIssuer,
    onchain,
    oracle: deps.oracle ?? nullOracle,
    objectStore: deps.objectStore ?? nullObjectStore,
    builderEndpoint: deps.builderEndpoint,
    builderToken: deps.builderToken,
    jwksUrl: deps.jwksUrl,
    treasuryAddress: deps.treasuryAddress,
    delegatedSigner: deps.delegatedSigner,
    headers: deps.headers,
  };
};
