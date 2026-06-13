// The root oRPC router (§12). Grows one milestone at a time; M1 = health +
// profile. The exported type backs the typed web client (./client).
import { publicProcedure } from "./orpc.ts";
import { appsRouter } from "./routers/apps.ts";
import { authRouter } from "./routers/auth.ts";
import { bridgeRouter } from "./routers/bridge.ts";
import { inboxRouter } from "./routers/inbox.ts";
import { profileRouter } from "./routers/profile.ts";

export const appRouter = {
  health: publicProcedure.handler(() => "OK"),
  profile: profileRouter,
  bridge: bridgeRouter,
  inbox: inboxRouter,
  auth: authRouter,
  apps: appsRouter,
};

export type AppRouter = typeof appRouter;
