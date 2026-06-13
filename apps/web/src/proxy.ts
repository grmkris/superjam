// Per-app frame-src CSP (pivot §3) — on the viewer path, look up the app's
// entryOrigin and allow ONLY that origin to be framed on that page. Tightest
// possible: a viewer page can frame exactly the one app it's showing. Falls back
// to 'self' if the lookup fails (the sandbox is the real boundary regardless).
import { type Environment, SERVICE_URLS } from "@superjam/shared";
import { type NextRequest, NextResponse } from "next/server";
import { createPlatformClient } from "./lib/orpc";

export const config = { matcher: "/app/:slug*" };

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.next();
  const slug = req.nextUrl.pathname.split("/")[2];
  let frameSrc = "'self'";
  if (slug) {
    try {
      const env = (process.env.NEXT_PUBLIC_APP_ENV ?? "local") as Environment;
      const app = await createPlatformClient({
        url: `${SERVICE_URLS[env].apiInternal}/rpc`,
      }).apps.get({ slug });
      if (app.entryOrigin) frameSrc = `'self' ${app.entryOrigin}`;
    } catch {
      /* unknown app / API down — keep the safe default */
    }
  }
  res.headers.set("content-security-policy", `frame-src ${frameSrc};`);
  return res;
}
