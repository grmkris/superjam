// Toybox sticker primitives (DESIGN_BRIEF §2): chunky 2px ink outlines, hard
// `0 3px 0` offset shadows, candy fills, press-down on tap. Everything looks
// like a sticker you could peel off the screen.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type StickerColor =
  | "pink"
  | "yellow"
  | "green"
  | "blue"
  | "white"
  | "cream"
  | "ink";

const FILL: Record<StickerColor, string> = {
  pink: "bg-pink text-white",
  yellow: "bg-yellow text-ink",
  green: "bg-green text-ink",
  blue: "bg-blue text-white",
  white: "bg-card text-ink",
  cream: "bg-cream text-ink",
  ink: "bg-ink text-cream",
};

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
    sm: "text-sm px-3 py-1.5 rounded-xl shadow-sticker-sm",
    md: "text-base px-4 min-h-[48px] rounded-toy shadow-sticker-md",
    lg: "text-lg px-6 min-h-[54px] rounded-toy shadow-sticker-md",
  }[size];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 border-2 border-ink font-extrabold",
        "sticker-press disabled:opacity-50 disabled:active:translate-y-0",
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
        "border-2 border-ink rounded-toy-lg shadow-sticker",
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
        "inline-flex items-center gap-1.5 border-2 border-ink rounded-full px-3 py-1 text-xs font-bold",
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
        "inline-flex items-center justify-center border-2 border-ink shadow-sticker shrink-0",
        rounded === "full" ? "rounded-full" : "rounded-2xl",
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
