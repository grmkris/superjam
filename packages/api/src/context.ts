// oRPC request context (§12). Long-lived deps (db, logger, auth verifier) are
// injected once; `headers` is per-request. The protected middleware reads the
// bearer token from `headers` and adds `user`.
import type { Database } from "@superjam/db";
import type { Logger } from "@superjam/logger";
import type { AuthVerifier } from "./auth/verifier.ts";
import type { RateLimiter } from "./lib/rate-limit.ts";

export interface ApiContext {
  db: Database;
  logger: Logger;
  auth: AuthVerifier;
  rateLimiter: RateLimiter;
  headers: Headers;
}

export interface CreateContextDeps {
  db: Database;
  logger: Logger;
  auth: AuthVerifier;
  rateLimiter: RateLimiter;
  headers: Headers;
}

export const createContext = (deps: CreateContextDeps): ApiContext => ({
  db: deps.db,
  logger: deps.logger,
  auth: deps.auth,
  rateLimiter: deps.rateLimiter,
  headers: deps.headers,
});
