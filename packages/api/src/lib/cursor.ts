// Opaque offset cursor — base64url of an integer offset. Shared by the
// paginated list services (data, reviews, …) so the encode/decode lives once.
export const encodeCursor = (offset: number): string =>
  Buffer.from(String(offset), "utf8").toString("base64url");

export const decodeCursor = (cursor?: string): number => {
  if (!cursor) {
    return 0;
  }
  const n = Number.parseInt(
    Buffer.from(cursor, "base64url").toString("utf8"),
    10
  );
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
