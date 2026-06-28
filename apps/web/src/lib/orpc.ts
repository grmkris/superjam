// Typed oRPC client the host uses to reach the platform API (pivot §3/§4). The
// browser hits the public /rpc (gateway-proxied, same-origin in dev/prod);
// server components + middleware hit the internal URL. Auth is the viewer's
// Dynamic JWT (for protected calls like auth.mintAppToken); public calls
// (apps.get) need none.
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouterClient } from "@superjam/api/client";
import { type Environment, SERVICE_URLS } from "@superjam/shared";

const APP_ENV = (process.env.NEXT_PUBLIC_APP_ENV ?? "local") as Environment;

/** Browser → platform: same-origin /rpc via the gateway (local: the API port). */
export const browserRpcUrl = (): string =>
  APP_ENV === "local"
    ? `${SERVICE_URLS.local.apiInternal}/rpc`
    : `${SERVICE_URLS[APP_ENV].web}/rpc`;

/** Server (page/middleware) → platform: the internal URL. */
export const serverRpcUrl = (): string =>
  `${SERVICE_URLS[APP_ENV].apiInternal}/rpc`;

export interface ClientOpts {
  url: string;
  /** Bearer token for protected procedures (the viewer's Dynamic JWT). May be
   *  async: the browser resolver awaits Dynamic init so a request fired before
   *  the SDK is ready WAITS for the token instead of going out tokenless (401). */
  getToken?: () =>
    | string
    | null
    | undefined
    | Promise<string | null | undefined>;
}

export const createPlatformClient = (opts: ClientOpts): AppRouterClient => {
  const link = new RPCLink({
    url: opts.url,
    headers: async () => {
      const t = await opts.getToken?.();
      return t ? { authorization: `Bearer ${t}` } : {};
    },
  });
  return createORPCClient(link);
};
