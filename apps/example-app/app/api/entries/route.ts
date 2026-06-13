// Guestbook entries in the app's OWN database. GET is public (app-scoped feed);
// POST requires a verified SuperJam identity and stamps it server-side.
import { z } from "zod";
import { addEntry, hasDatabase, listEntries } from "../../../lib/db";
import { userFromRequest } from "../../../lib/superjam";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const entries = await listEntries();
  return Response.json({ entries, hasDatabase: hasDatabase() });
}

const PostBody = z.object({ message: z.string().min(1).max(280) });

export async function POST(req: Request): Promise<Response> {
  const user = await userFromRequest(req);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = PostBody.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "bad message" }, { status: 400 });
  }
  // Identity is stamped from the VERIFIED token, never the request body.
  const entry = await addEntry({
    superjamUserId: user.userId,
    username: user.username,
    worldVerified: user.worldVerified,
    message: body.data.message,
  });
  return Response.json({ entry }, { status: 201 });
}
