"use client";

// usePlatformClient — the typed oRPC client (%67's lib/orpc) bound to the
// viewer's Dynamic JWT (%67's useHostAuth). Product flows that hit protected
// procedures (builds.refine/create, profile.me, inbox.*, agents.list) use this.
import { useMemo } from "react";
import type { AppRouterClient } from "@superjam/api/client";
import { browserRpcUrl, createPlatformClient } from "../lib/orpc";
import { useHostAuth } from "../lib/use-host-auth";

export function usePlatformClient(): AppRouterClient {
  const { authToken } = useHostAuth();
  return useMemo(
    () =>
      createPlatformClient({
        url: browserRpcUrl(),
        getToken: () => authToken,
      }),
    [authToken]
  );
}
