// User upsert from verified Dynamic claims (§13). One human = one account,
// keyed on dynamicUserId; username derived from the email prefix, sanitized,
// reserved-checked (§11), and deduped with a numeric suffix.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { RESERVED_LABELS } from "@superjam/shared";
import { eq } from "drizzle-orm";
import type { DynamicClaims } from "./verifier.ts";

const { user } = schema;
type User = typeof schema.user.$inferSelect;

const RESERVED = new Set<string>(RESERVED_LABELS);

const sanitizeBase = (email: string): string => {
  const prefix = email.split("@")[0] ?? "user";
  const cleaned = prefix.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const trimmed = cleaned.replace(/^-+|-+$/g, "").slice(0, 24);
  if (trimmed.length >= 3) {
    return trimmed;
  }
  return `${trimmed}user`.slice(0, 24);
};

/** First free `base`, `base2`, `base3`, … not taken and not reserved. */
const deriveUniqueUsername = async (
  db: Database,
  email: string
): Promise<string> => {
  const base = sanitizeBase(email);
  for (let n = 0; n < 10_000; n += 1) {
    const candidate = n === 0 ? base : `${base}${n + 1}`;
    if (RESERVED.has(candidate)) {
      continue;
    }
    const taken = await db.query.user.findFirst({
      columns: { id: true },
      where: eq(user.username, candidate),
    });
    if (!taken) {
      return candidate;
    }
  }
  // Astronomically unlikely; fall back to a globally-unique-ish suffix.
  return `${base}${Date.now()}`;
};

export const upsertUserFromClaims = async (
  db: Database,
  claims: DynamicClaims
): Promise<User> => {
  const existing = await db.query.user.findFirst({
    where: eq(user.dynamicUserId, claims.dynamicUserId),
  });

  if (existing) {
    // Capture a wallet address that showed up after first login.
    if (claims.walletAddress && existing.walletAddress !== claims.walletAddress) {
      const [updated] = await db
        .update(user)
        .set({ walletAddress: claims.walletAddress })
        .where(eq(user.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  const username = await deriveUniqueUsername(db, claims.email);
  const [created] = await db
    .insert(user)
    .values({
      dynamicUserId: claims.dynamicUserId,
      email: claims.email,
      username,
      walletAddress: claims.walletAddress,
    })
    .returning();
  if (!created) {
    throw new Error("Failed to create user");
  }
  return created;
};
