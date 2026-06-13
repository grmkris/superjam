// Skeleton — the single loading-placeholder primitive (replaces scattered
// `animate-pulse` divs). Toybox-tinted (ink wash on the card surface).
import { cx } from "./cx";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-toy bg-ink/10", className)}
      aria-hidden
    />
  );
}
