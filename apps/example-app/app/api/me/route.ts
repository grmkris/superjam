// Identity probe — returns the VERIFIED SuperJam user for the Bearer token the
// client got from `sdk.auth.getToken()`. The single source of truth for "who is
// this": never trust a client-supplied id.
import { userFromRequest } from "../../../lib/superjam";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await userFromRequest(req);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ user });
}
