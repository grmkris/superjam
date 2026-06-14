// Web-safe Unlink constants (§23). Split out of unlink-user.ts so the BROWSER can
// import the canonical derivation message without pulling "@unlink-xyz/sdk/admin"
// (server-only). The message MUST be byte-identical wherever it's signed — server
// (createUserUnlink) and browser (the bootstrap-privacy step) — or the derived
// shielded account won't match. unlink-user.ts re-exports these for its callers.

/** The fixed message the user's wallet signs to derive its Unlink account. */
export const CANON_UNLINK_MESSAGE =
  "SuperJam private balance — derive my Unlink account (v1)";

/** App-scoping for account derivation (ties the derived account to SuperJam). */
export const UNLINK_APP_ID = "superjam";

/** Unlink hosted environment for the private rail (matches PRIVATE_CHAIN = Arc). */
export const UNLINK_ENVIRONMENT = "arc-testnet";
