// SuperJam app manifest (pivot, Farcaster-style well-known). The platform reads
// this at registration to learn name/icon/category/capabilities + the entry URL.
// homeUrl is what the host frames.
export const runtime = "nodejs";

const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const HOME_URL =
  process.env.SUPERJAM_HOME_URL ??
  (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000");

export function GET(): Response {
  return Response.json({
    version: "1",
    name: "Guestbook",
    slug: "guestbook",
    iconEmoji: "📖",
    category: "social",
    // Declared capabilities the app uses via the SDK (host gates these).
    capabilities: ["payments"],
    homeUrl: HOME_URL,
    appId: process.env.SUPERJAM_APP_ID ?? null,
  });
}
