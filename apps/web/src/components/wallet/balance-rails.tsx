"use client";

// The two-rail balance view for the /wallet showcase: a PUBLIC rail (⚡ Arc, out
// in the open) and the PRIVATE VAULT (🔒 shielded, the hero). Values tween on
// change so an airdrop / shield reads as money actually moving. Toybox sticker
// language throughout (see ui/sticker.tsx).
import { useEffect, useRef, useState } from "react";
import { EmojiToken, StickerCard, type StickerColor } from "../ui/sticker";
import { Skeleton } from "../ui/skeleton";

/** A USDC amount that tweens from its previous value to the new one (~0.6s) so a
 *  balance change is visibly animated. `value` is the decimal string from the API
 *  (e.g. "2.0"); null renders "—". */
function AnimatedUsdc({ value, big }: { value: string | null; big?: boolean }) {
  const target = value === null ? null : Number(value);
  const [shown, setShown] = useState<number | null>(target);
  const fromRef = useRef<number>(target ?? 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setShown(null);
      return;
    }
    const from = fromRef.current;
    const to = target;
    if (from === to) {
      setShown(to);
      return;
    }
    const start = performance.now();
    const dur = 600;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) * (1 - t); // ease-out quad
      setShown(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [target]);

  const text = shown === null ? "—" : shown.toFixed(2);
  return (
    <div className={big ? "text-hero font-extrabold" : "text-h2 font-extrabold"}>
      {text} <span className={big ? "text-2xl text-muted" : "text-body text-muted"}>USDC</span>
    </div>
  );
}

export function BalanceRail({
  emoji,
  color,
  label,
  sub,
  value,
  loading,
  hero,
  dim,
  className,
}: {
  emoji: string;
  color: StickerColor;
  label: string;
  sub: string;
  value: string | null;
  loading: boolean;
  hero?: boolean;
  /** briefly fade the rail being drained while money flies out of it. */
  dim?: boolean;
  className?: string;
}) {
  return (
    <StickerCard
      color="white"
      className={`p-5 flex items-center gap-4 shadow-sticker-md transition-opacity duration-300 ${
        dim ? "opacity-60" : ""
      } ${className ?? ""}`}
    >
      <EmojiToken emoji={emoji} color={color} size={hero ? 52 : 44} rounded="toy" tilt={-4} />
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">{label}</div>
        {loading ? (
          <Skeleton className={hero ? "h-11 w-44" : "h-8 w-36"} />
        ) : (
          <AnimatedUsdc value={value} big={hero} />
        )}
        <div className="text-small font-semibold text-muted">{sub}</div>
      </div>
    </StickerCard>
  );
}
