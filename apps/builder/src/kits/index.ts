// Use-case kit registry + selection. selectKit mirrors selectRecipes (keyword/skill/
// category match). Empty registry ⇒ builds use the generic skeleton + the generic
// anti-coast gate; kits are added here as they're authored.
import type { AppSpec } from "@superjam/shared";
import type { Kit, MatchOpts } from "./types.ts";
import { aiRoastKit } from "./ai-roast.ts";
import { dailyGuessKit } from "./daily-guess.ts";
import { guestbookKit } from "./guestbook.ts";
import { onchainKit } from "./onchain.ts";
import { personalityQuizKit } from "./personality-quiz.ts";
import { photoAlbumKit } from "./photo-album.ts";
import { pollKit } from "./poll.ts";
import { quizKit } from "./quiz.ts";
import { tapArcadeKit } from "./tap-arcade.ts";
import { tierListKit } from "./tier-list.ts";
import { travelKit } from "./travel.ts";

export type { GateResult, Kit, KitContext, MatchOpts } from "./types.ts";
export { genericGate } from "./gate.ts";
export { resultCardComponent } from "./_share.ts";

// Order = priority (first match wins). onchain FIRST (explicit skill signal). Then the
// VIRAL kits (specific "which-are-you / roast / tier / wordle" matches) ahead of the
// generic keyword kits — e.g. "personality quiz" → personality-quiz, not quiz.
// photo-album BEFORE travel: more specific (requires uploaded images).
// quiz + poll BEFORE tap-arcade: tap-arcade matches category==="game" broadly, so the
// specific keyword kits (trivia → quiz, vote → poll) must win first for game-category jams.
const KITS: Kit[] = [
  onchainKit,
  personalityQuizKit,
  aiRoastKit,
  tierListKit,
  dailyGuessKit,
  quizKit,
  pollKit,
  tapArcadeKit,
  guestbookKit,
  photoAlbumKit,
  travelKit,
];

/** First kit whose match() accepts the spec, or null (→ generic skeleton + gate). */
export const selectKit = (spec: AppSpec, opts?: MatchOpts): Kit | null =>
  KITS.find((k) => k.match(spec, opts)) ?? null;
