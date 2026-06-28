// Landing backdrop — a few quiet "jam" tiles (emoji on hairline white cards)
// drifting behind the sign-in card. Studio-calm: muted neutral tiles at very low
// opacity that frame the side-gutters, never candy chaos. Kept the gentle float.
//
// Float vs tilt: a CSS animation's `transform` overrides an element's own
// transform, so the bob (translateY-only, via the sjfloat/sjfloat2 keyframes in
// globals.css) lives on a wrapper span while the inner EmojiToken keeps its
// static rotate(tilt) — same separation the slide does with its --rot var.
//
// The `anim` strings are spelled out as complete literals (not built from parts)
// so Tailwind's class scanner actually compiles each motion-safe:animate-[…]
// utility. Purely decorative: pointer-events-none + absolute inset-0 behind content.
import type { StickerColor } from "./sticker";
import { EmojiToken } from "./sticker";

type Tile = {
  emoji: string;
  color: StickerColor;
  size: number;
  tilt: number;
  /** absolute placement within the column */
  pos: string;
  /** full Tailwind animation utility (literal, scanner-visible) */
  anim: string;
  delay: number;
};

// A few quiet tiles on neutral (white/cream/lavender) hairline cards, kept small
// and gently tilted so they read as soft furniture, not a candy scatter. The
// whole layer rides at very low opacity (see the container) to stay near-invisible.
const TILES: Tile[] = [
  { emoji: "🎮", color: "white", size: 56, tilt: -4, pos: "top-16 left-3", anim: "motion-safe:animate-[sjfloat_5s_ease-in-out_infinite]", delay: 0 },
  { emoji: "🎨", color: "lavender", size: 52, tilt: 3, pos: "top-10 right-4", anim: "motion-safe:animate-[sjfloat2_5.8s_ease-in-out_infinite]", delay: 0.4 },
  { emoji: "🎲", color: "cream", size: 50, tilt: -3, pos: "bottom-24 left-3", anim: "motion-safe:animate-[sjfloat_5.7s_ease-in-out_infinite]", delay: 0.2 },
  { emoji: "🏆", color: "white", size: 54, tilt: 4, pos: "bottom-14 right-3", anim: "motion-safe:animate-[sjfloat2_5.3s_ease-in-out_infinite]", delay: 0.55 },
];

type Sparkle = {
  pos: string;
  size: string; // text-* utility
  color: string; // text-* utility
  anim: string;
  delay: number;
};

// Two faint accents only — just enough motion, no glitter.
const SPARKLES: Sparkle[] = [
  { pos: "top-24 right-[30%]", size: "text-base", color: "text-faint", anim: "motion-safe:animate-[sjfloat2_5s_ease-in-out_infinite]", delay: 0.35 },
  { pos: "bottom-32 left-[26%]", size: "text-base", color: "text-faint", anim: "motion-safe:animate-[sjfloat_5.4s_ease-in-out_infinite]", delay: 0.2 },
];

export function JamBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-40">
      {TILES.map((t, i) => (
        <span
          key={`t${i}`}
          className={`absolute ${t.pos} ${t.anim}`}
          style={{ animationDelay: `${t.delay}s` }}
        >
          <EmojiToken emoji={t.emoji} color={t.color} size={t.size} rounded="toy" tilt={t.tilt} />
        </span>
      ))}
      {SPARKLES.map((s, i) => (
        <span
          key={`s${i}`}
          className={`absolute ${s.pos} ${s.size} ${s.color} ${s.anim}`}
          style={{ animationDelay: `${s.delay}s` }}
        >
          ✦
        </span>
      ))}
    </div>
  );
}
