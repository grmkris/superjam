// Badge + Dot — solid little status/count chips (unread counts, ratings,
// remix/free tags). Replaces ad-hoc styled <span>s. For bordered "sticker
// pills" (filters/attributions) use `Pill` from sticker.tsx instead.
import type { ReactNode } from "react";
import { cx } from "./cx";
import { FILL, type StickerColor } from "./sticker";

export function Badge({
  color = "pink",
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
        "inline-flex min-w-5 items-center justify-center gap-1 rounded-full border-[1.5px] border-ink px-2 py-0.5 text-tiny font-extrabold leading-none tracking-tight tabular-nums",
        FILL[color],
        className
      )}
    >
      {children}
    </span>
  );
}

/** A bare unread dot (no count). */
export function Dot({ className }: { className?: string }) {
  return <span className={cx("inline-block size-2 rounded-full bg-pink", className)} />;
}
