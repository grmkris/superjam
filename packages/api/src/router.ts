// The root oRPC router (§12). The exported type backs the typed web client
// (./client). Lanes own their router files; the integrator wires them here.
import { publicProcedure } from "./orpc.ts";
import { agentsRouter } from "./routers/agents.ts";
import { appsRouter } from "./routers/apps.ts";
import { authRouter } from "./routers/auth.ts";
import { bridgeRouter } from "./routers/bridge.ts";
import { buildsRouter } from "./routers/builds.ts";
import { inboxRouter } from "./routers/inbox.ts";
import { paymentsRouter } from "./routers/payments.ts";
import { profileRouter } from "./routers/profile.ts";
import { publishRouter } from "./routers/publish.ts";
import { reviewsRouter } from "./routers/reviews.ts";
import { worldRouter } from "./routers/world.ts";

export const appRouter = {
  health: publicProcedure.handler(() => "OK"),
  profile: profileRouter,
  bridge: bridgeRouter,
  inbox: inboxRouter,
  auth: authRouter,
  apps: appsRouter,
  agents: agentsRouter,
  builds: buildsRouter,
  world: worldRouter,
  publish: publishRouter,
  payments: paymentsRouter,
  reviews: reviewsRouter,
};

export type AppRouter = typeof appRouter;
