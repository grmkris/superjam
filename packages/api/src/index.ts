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
export { commonErrors, type CommonErrorCode } from "./errors.ts";
export {
  base,
  publicProcedure,
  protectedProcedure,
  worldVerifiedProcedure,
} from "./orpc.ts";
export type { AppRouterClient } from "./client.ts";
