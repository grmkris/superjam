/** Extract a bearer token from an Authorization header (case-insensitive). */
export const extractBearer = (headers: Headers): string | null => {
  const raw = headers.get("authorization") ?? headers.get("Authorization");
  if (!raw) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() || null;
};
