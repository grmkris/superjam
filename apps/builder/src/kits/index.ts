// Use-case kit registry + selection. selectKit mirrors selectRecipes (keyword/skill/
// category match). Empty registry ⇒ builds use the generic skeleton + the generic
// anti-coast gate; kits are added here as they're authored.
import type { AppSpec } from "@superjam/shared";
import type { Kit, MatchOpts } from "./types.ts";
import { guestbookKit } from "./guestbook.ts";
import { photoAlbumKit } from "./photo-album.ts";
import { pollKit } from "./poll.ts";
import { quizKit } from "./quiz.ts";
import { tapArcadeKit } from "./tap-arcade.ts";
import { travelKit } from "./travel.ts";

export type { GateResult, Kit, KitContext, MatchOpts } from "./types.ts";
export { genericGate } from "./gate.ts";

// Order = priority (first match wins). photo-album BEFORE travel: it's the more
// specific match (requires uploaded images), so a trip+photos spec gets the album.
const KITS: Kit[] = [tapArcadeKit, quizKit, pollKit, guestbookKit, photoAlbumKit, travelKit];

/** First kit whose match() accepts the spec, or null (→ generic skeleton + gate). */
export const selectKit = (spec: AppSpec, opts?: MatchOpts): Kit | null =>
  KITS.find((k) => k.match(spec, opts)) ?? null;
