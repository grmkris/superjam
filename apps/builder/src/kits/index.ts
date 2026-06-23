// Use-case kit registry + selection. selectKit mirrors selectRecipes (keyword/skill/
// category match). Empty registry ⇒ builds use the generic skeleton + the generic
// anti-coast gate; kits are added here as they're authored.
import type { AppSpec } from "@superjam/shared";
import type { Kit } from "./types.ts";
import { tapArcadeKit } from "./tap-arcade.ts";

export type { GateResult, Kit, KitContext } from "./types.ts";
export { genericGate } from "./gate.ts";

const KITS: Kit[] = [tapArcadeKit];

/** First kit whose match() accepts the spec, or null (→ generic skeleton + gate). */
export const selectKit = (spec: AppSpec): Kit | null =>
  KITS.find((k) => k.match(spec)) ?? null;
