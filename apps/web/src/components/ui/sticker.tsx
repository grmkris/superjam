// Sticker primitives — the "Refined Arcade" surface: crisp 1.5px ink outlines,
// LAYERED depth (a sharp offset + a soft ambient drop via shadow-sticker*), vivid
// fills, and a tactile press-down on tap. Confident and tactile, never toy-like.
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

export const FILL: Record<StickerColor, string> = {
  pink: "bg-pink text-white",
  yellow: "bg-yellow text-ink",
  green: "bg-green text-ink",
  blue: "bg-blue text-white",
  lavender: "bg-lavender text-ink",
  white: "bg-card text-ink",
  cream: "bg-cream text-ink",
  ink: "bg-ink text-cream",
};

// A sticker list/menu row: emoji + label on a bordered card.
export const actionRow =
  "flex items-center gap-3 rounded-toy border-[1.5px] border-ink bg-card p-3 shadow-sticker-sm";
// Interactive variant — button/link rows that press down on tap.
export const actionRowButton = cx(actionRow, "focus-ring sticker-press w-full text-left");

export interface StickerButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  color?: StickerColor;
  size?: "sm" | "md" | "lg";
  block?: boolean;
}

export function StickerButton({
  color = "pink",
  size = "md",
  block,
  className,
  children,
  ...rest
}: StickerButtonProps) {
  const sizes = {
    sm: "text-sm px-3 py-1.5 rounded-toy shadow-sticker-sm",
    md: "text-base px-4 min-h-[48px] rounded-toy shadow-sticker-md",
    lg: "text-lg px-6 min-h-[54px] rounded-toy shadow-sticker-md",
  }[size];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 border-[1.5px] border-ink font-extrabold",
        "focus-ring sticker-press disabled:opacity-50 disabled:active:translate-y-0",
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
        "border-[1.5px] border-ink rounded-toy-lg shadow-sticker",
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
        "inline-flex items-center gap-1.5 border-[1.5px] border-ink rounded-full px-3 py-1 text-xs font-bold",
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
        "inline-flex items-center justify-center border-[1.5px] border-ink shadow-sticker shrink-0",
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
