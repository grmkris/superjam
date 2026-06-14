"use client";

// usePlatformClient — the typed oRPC client (%67's lib/orpc) bound to the
// viewer's Dynamic JWT (%67's useHostAuth). Product flows that hit protected
// procedures (builds.refine/create, profile.me, inbox.*, agents.list) use this.
import { useMemo } from "react";
import type { AppRouterClient } from "@superjam/api/client";
import { browserRpcUrl, createPlatformClient } from "../lib/orpc";
import { useHostAuth } from "../lib/use-host-auth";

export function usePlatformClient(): AppRouterClient {
  const { getToken } = useHostAuth();
  // `getToken` is render-stable and resolves the token at request time (awaiting
  // Dynamic init), so the client is built ONCE — no churn/double-fire when auth
  // resolves, and protected calls fired on mount wait for the Bearer token.
  return useMemo(
    () =>
      createPlatformClient({
        url: browserRpcUrl(),
        getToken,
      }),
    [getToken]
  );
}
