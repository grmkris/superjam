// Personal Access Token (PAT) — a long-lived `sjat_…` bearer the user mints to let
// an external agent (their Claude Code, via the SuperJam MCP) act AS them. The raw
// token is shown once; only its SHA-256 hash is stored (`user_token`). The auth
// middleware resolves a `sjat_` bearer → the owning user, so every protected
// procedure transparently accepts a PAT.
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { and, eq, gt, isNull, or } from "drizzle-orm";

const { userToken, user } = schema;
type User = typeof user.$inferSelect;

export const PAT_PREFIX = "sjat_";

export const hashToken = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

/** Mint a fresh PAT: the raw token (return ONCE), its hash (store), a display preview. */
export const generatePat = (): { raw: string; hash: string; preview: string } => {
  const raw = `${PAT_PREFIX}${randomBytes(32).toString("hex")}`;
  return { raw, hash: hashToken(raw), preview: `${raw.slice(0, 12)}…` };
};

/** Resolve a `sjat_` PAT → its owning user (verify hash + not-expired), best-effort
 *  touch lastUsedAt. Returns null when unknown/expired. */
export const resolveUserFromPat = async (
  db: Database,
  raw: string
): Promise<User | null> => {
  const row = await db.query.userToken.findFirst({
    columns: { id: true, userId: true },
    where: and(
      eq(userToken.tokenHash, hashToken(raw)),
      or(isNull(userToken.expiresAt), gt(userToken.expiresAt, new Date()))
    ),
  });
  if (!row) return null;
  void db
    .update(userToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(userToken.id, row.id))
    .catch(() => {});
  const u = await db.query.user.findFirst({ where: eq(user.id, row.userId) });
  return u ?? null;
};
