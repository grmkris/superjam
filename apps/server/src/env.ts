import { parseServerEnv } from "@superjam/shared/env";

// Fail-fast validation at boot (§5). Throws a readable aggregate if a required
// var is missing/invalid.
export const env = parseServerEnv(process.env);
