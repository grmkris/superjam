// The root oRPC router (§12). The exported type backs the typed web client
// (./client). Lanes own their router files; the integrator wires them here.
import { publicProcedure } from "./orpc.ts";
import { appsRouter } from "./routers/apps.ts";
import { authRouter } from "./routers/auth.ts";
import { bridgeRouter } from "./routers/bridge.ts";
import { buildsRouter } from "./routers/builds.ts";
import { chatRouter } from "./routers/chat.ts";
import { friendsRouter } from "./routers/friends.ts";
import { inboxRouter } from "./routers/inbox.ts";
import { paymentsRouter } from "./routers/payments.ts";
import { profileRouter } from "./routers/profile.ts";
import { publishRouter } from "./routers/publish.ts";
import { reviewsRouter } from "./routers/reviews.ts";
import { uploadsRouter } from "./routers/uploads.ts";

export const appRouter = {
  health: publicProcedure.handler(() => "OK"),
  profile: profileRouter,
  bridge: bridgeRouter,
  inbox: inboxRouter,
  auth: authRouter,
  apps: appsRouter,
  builds: buildsRouter,
  publish: publishRouter,
  payments: paymentsRouter,
  reviews: reviewsRouter,
  friends: friendsRouter,
  chat: chatRouter,
  uploads: uploadsRouter,
};

export type AppRouter = typeof appRouter;
