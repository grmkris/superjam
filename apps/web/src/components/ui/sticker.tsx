// Sticker primitives — the "Studio" surface: white cards with a 1px hairline +
// soft ambient shadow, solid clean buttons (no contrasting outline), a subtle
// scale on press. Refined and editorial, never toy-like. (Names kept as a
// contract; only the look evolved.)
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type StickerColor =
  | "pink"
  | "yellow"
  | "green"
  | "blue"
  | "lavender"
  | "white"
  | "cream"
  | "ink";

// Solid fills. `ink` is the default primary (near-black, Studio); `pink` is the
// one accent (hero CTAs, key highlights). white/cream are quiet secondaries that
// carry a hairline so they read on the near-white canvas. The colour fills
// (yellow/green/blue/lavender) are for per-content identity, used sparingly.
export const FILL: Record<StickerColor, string> = {
  ink: "bg-ink text-white",
  pink: "bg-pink text-white",
  yellow: "bg-yellow text-ink",
  green: "bg-green text-white",
  blue: "bg-blue text-white",
  lavender: "bg-lavender text-ink",
  white: "bg-card text-ink border border-line",
  cream: "bg-paper text-ink border border-line",
};

// A list/menu row: emoji + label on a hairline card.
export const actionRow =
  "flex items-center gap-3 rounded-toy border border-line bg-card p-3 shadow-sticker-sm";
// Interactive variant — button/link rows that press on tap.
export const actionRowButton = cx(actionRow, "focus-ring sticker-press w-full text-left");

export interface StickerButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  color?: StickerColor;
  size?: "sm" | "md" | "lg";
  block?: boolean;
}

export function StickerButton({
  color = "ink",
  size = "md",
  block,
  className,
  children,
  ...rest
}: StickerButtonProps) {
  const sizes = {
    sm: "text-sm px-3.5 py-2 rounded-toy",
    md: "text-base px-5 min-h-[48px] rounded-toy",
    lg: "text-lg px-7 min-h-[54px] rounded-toy",
  }[size];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 font-bold shadow-sticker-sm",
        "focus-ring sticker-press disabled:opacity-50",
        sizes,
        FILL[color],
        block && "w-full",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A flat outlined card with the signature sticker shadow. */
export function StickerCard({
  color = "white",
  className,
  children,
  tilt,
}: {
  color?: StickerColor;
  className?: string;
  children: ReactNode;
  /** small playful rotation in degrees */
  tilt?: number;
}) {
  return (
    <div
      className={cx(
        "border border-line rounded-toy-lg shadow-sticker",
        FILL[color],
        className
      )}
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      {children}
    </div>
  );
}

/** A rounded-pill chip — used for filters, attributions, small facts. */
export function Pill({
  color = "white",
  className,
  children,
}: {
  color?: StickerColor;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 border border-line rounded-full px-3 py-1 text-xs font-bold",
        FILL[color],
        className
      )}
    >
      {children}
    </span>
  );
}

/** A round emoji "token" — avatars, icon badges. */
export function EmojiToken({
  emoji,
  color = "yellow",
  size = 44,
  rounded = "full",
  tilt,
  className,
}: {
  emoji: string;
  color?: StickerColor;
  size?: number;
  rounded?: "full" | "toy";
  tilt?: number;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center border border-line shadow-sticker shrink-0",
        rounded === "full" ? "rounded-full" : "rounded-toy",
        FILL[color],
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
      }}
    >
      {emoji}
    </span>
  );
}
