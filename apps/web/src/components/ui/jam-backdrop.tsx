// Landing backdrop — recreates slide 1 of the SuperJam pitch deck: a scatter of
// chunky candy "jam" tiles (emoji on ink-outlined rounded squares) + ✦ sparkles,
// gently bobbing behind the sign-in card. Re-laid-out for the phone-width column
// so the tiles frame the corners/side-gutters instead of covering the card.
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

// Emoji/color set mirrors the slide's title scatter (🎮 💸 🏷️ 🤖 🎨 🎲 🏆),
// scaled down (~56–72px) to frame the ≤460px column rather than cover it.
const TILES: Tile[] = [
  { emoji: "🎮", color: "yellow", size: 72, tilt: -10, pos: "top-16 left-3", anim: "motion-safe:animate-[sjfloat_5s_ease-in-out_infinite]", delay: 0 },
  { emoji: "🎨", color: "lavender", size: 60, tilt: 8, pos: "top-10 right-4", anim: "motion-safe:animate-[sjfloat2_5.8s_ease-in-out_infinite]", delay: 0.4 },
  { emoji: "🤖", color: "green", size: 64, tilt: -8, pos: "top-36 right-2", anim: "motion-safe:animate-[sjfloat2_6.2s_ease-in-out_infinite]", delay: 0.15 },
  { emoji: "🎲", color: "pink", size: 56, tilt: 9, pos: "top-44 left-2", anim: "motion-safe:animate-[sjfloat_5.2s_ease-in-out_infinite]", delay: 0.5 },
  { emoji: "🏷️", color: "blue", size: 60, tilt: -7, pos: "bottom-24 left-3", anim: "motion-safe:animate-[sjfloat_5.7s_ease-in-out_infinite]", delay: 0.2 },
  { emoji: "🏆", color: "yellow", size: 64, tilt: 7, pos: "bottom-14 right-3", anim: "motion-safe:animate-[sjfloat2_5.3s_ease-in-out_infinite]", delay: 0.55 },
  { emoji: "💸", color: "pink", size: 68, tilt: 10, pos: "bottom-40 right-4", anim: "motion-safe:animate-[sjfloat_6s_ease-in-out_infinite]", delay: 0.3 },
];

type Sparkle = {
  pos: string;
  size: string; // text-* utility
  color: string; // text-* utility
  anim: string;
  delay: number;
};

const SPARKLES: Sparkle[] = [
  { pos: "top-28 left-[28%]", size: "text-2xl", color: "text-ink", anim: "motion-safe:animate-[sjfloat_4.6s_ease-in-out_infinite]", delay: 0 },
  { pos: "top-20 right-[30%]", size: "text-lg", color: "text-blue", anim: "motion-safe:animate-[sjfloat2_5s_ease-in-out_infinite]", delay: 0.35 },
  { pos: "bottom-28 left-[24%]", size: "text-xl", color: "text-green", anim: "motion-safe:animate-[sjfloat2_4.8s_ease-in-out_infinite]", delay: 0.6 },
  { pos: "bottom-44 right-[26%]", size: "text-base", color: "text-pink", anim: "motion-safe:animate-[sjfloat_5.4s_ease-in-out_infinite]", delay: 0.2 },
];

export function JamBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
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
