// Use-case kit registry + selection. selectKit mirrors selectRecipes (keyword/skill/
// category match). Empty registry ⇒ builds use the generic skeleton + the generic
// anti-coast gate; kits are added here as they're authored.
import type { AppSpec } from "@superjam/shared";
import type { Kit, MatchOpts } from "./types.ts";
import { guestbookKit } from "./guestbook.ts";
import { onchainKit } from "./onchain.ts";
import { photoAlbumKit } from "./photo-album.ts";
import { pollKit } from "./poll.ts";
import { quizKit } from "./quiz.ts";
import { tapArcadeKit } from "./tap-arcade.ts";
import { travelKit } from "./travel.ts";

export type { GateResult, Kit, KitContext, MatchOpts } from "./types.ts";
export { genericGate } from "./gate.ts";

// Order = priority (first match wins). onchain FIRST: the "onchain" skill is an
// explicit, strong signal (a vetted contract template), so it wins over keyword
// kits. photo-album BEFORE travel: more specific (requires uploaded images).
const KITS: Kit[] = [onchainKit, tapArcadeKit, quizKit, pollKit, guestbookKit, photoAlbumKit, travelKit];

/** First kit whose match() accepts the spec, or null (→ generic skeleton + gate). */
export const selectKit = (spec: AppSpec, opts?: MatchOpts): Kit | null =>
  KITS.find((k) => k.match(spec, opts)) ?? null;
