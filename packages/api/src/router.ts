// The root oRPC router (§12). Grows one milestone at a time; M1 = health +
// profile. The exported type backs the typed web client (./client).
import { publicProcedure } from "./orpc.ts";
import { profileRouter } from "./routers/profile.ts";

export const appRouter = {
  health: publicProcedure.handler(() => "OK"),
  profile: profileRouter,
};

export type AppRouter = typeof appRouter;
