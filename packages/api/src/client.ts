// Typed client contract for the web app (web imports types only, §4).
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "./router.ts";

export type { AppRouter } from "./router.ts";
export type AppRouterClient = RouterClient<AppRouter>;
