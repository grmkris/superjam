// @superjam/api — oRPC routers + context (§4). The server imports the impl
// (appRouter, createContext, verifier); the web app imports types (./client).
export { appRouter, type AppRouter } from "./router.ts";
export { createContext, type ApiContext, type CreateContextDeps } from "./context.ts";
export {
  type AuthVerifier,
  type DynamicClaims,
  createDynamicVerifier,
  createJoseVerifier,
} from "./auth/verifier.ts";
export {
  type AppTokenIssuer,
  type AppIdentityClaims,
  AppTokenNotConfiguredError,
  APP_TOKEN_TTL_SECONDS,
  createAppTokenIssuer,
  createAppTokenVerifier,
  createRemoteAppTokenVerifier,
  createLocalAppTokenVerifier,
  nullAppTokenIssuer,
} from "./auth/app-token.ts";
export {
  type WorldVerifier,
  type WorldProof,
  type WorldVerifyResult,
  createWorldVerifier,
  nullWorldVerifier,
  WorldNotConfiguredError,
} from "./auth/world.ts";
export {
  type AgentIdentity,
  type AgentIdentityInput,
  type AgentIdentityResult,
  nullAgentIdentity,
} from "./lib/agent-identity.ts";
export {
  allocateExternalApp,
  type AllocateExternalAppInput,
  finalizeExternalApp,
  type FinalizeExternalAppInput,
  createExternalApp,
  type CreateExternalAppInput,
} from "./routers/apps.ts";
export { commonErrors, type CommonErrorCode } from "./errors.ts";
// Onchain wiring re-exported so the composition root (apps/server) gets it
// without a second direct dependency (§15).
export {
  createOnchainFromConfig,
  nullOnchain,
  type Onchain,
  type OnchainConfig,
  loadLiveUnlinkTransport,
} from "@superjam/onchain";
export { type PotOracle, nullOracle } from "./lib/oracle.ts";
export { createRateLimiter, type RateLimiter } from "./lib/rate-limit.ts";
export { createCounterService } from "./services/counter-service.ts";
export { createStorageService } from "./services/storage-service.ts";
export { createDataService } from "./services/data-service.ts";
export { createMessageService } from "./services/message-service.ts";
export {
  base,
  publicProcedure,
  protectedProcedure,
  worldVerifiedProcedure,
} from "./orpc.ts";
export type { AppRouterClient } from "./client.ts";
