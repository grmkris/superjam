// Detect a Postgres unique-constraint violation through Drizzle's wrapper.
// Drizzle throws a DrizzleQueryError whose `.cause` is the pg error; the
// unique_violation SQLSTATE is 23505. Used to turn txHash/slug collisions into
// a clean CONFLICT (the replay guard, §7).
export const isUniqueViolation = (err: unknown): boolean => {
  const cause = (err as { cause?: { code?: string } })?.cause;
  if (cause?.code === "23505") return true;
  // Fallback for drivers that surface the text only.
  return /unique constraint|duplicate key/i.test(String(err));
};
