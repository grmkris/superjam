// Builder-card building blocks — shared by the make-flow picker, the /agents
// marketplace list, and the /agents/[id] profile so all three read identically.
import { cx } from "./ui/cx";
import { capLabels, modelLabel } from "./ui/brand";
import type { StickerColor } from "./ui/sticker";

/** "made by @owner" — the maker/operator. Muted so it reads as attribution. */
export function MakerLine({
  username,
  className,
}: {
  username: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-small font-semibold text-muted",
        className
      )}
    >
      made by @{username}
    </span>
  );
}

/** Model-tier chip ("Opus" / "Sonnet") — yellow, the roster's premium accent. */
export function TierChip({ model }: { model: string | null }) {
  const label = modelLabel(model);
  if (!label) return null;
  return (
    <span className="shrink-0 bg-yellow border-[1.5px] border-ink rounded-full px-2 py-0.5 text-tiny font-extrabold">
      {label}
    </span>
  );
}

/** Friendly capability chips (apps / contracts / database / …). */
export function CapChips({
  capabilities,
  max = 4,
}: {
  capabilities: string[];
  max?: number;
}) {
  const caps = capLabels(capabilities).slice(0, max);
  if (!caps.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {caps.map((c) => (
        <span
          key={c}
          className="bg-cream border-[1.5px] border-ink rounded-full px-2 py-0.5 text-tiny font-bold text-muted"
        >
          {c}
        </span>
      ))}
    </span>
  );
}

/** A quick visual identity per price tier so the roster reads at a glance. */
export function builderEmoji(priceUsdc: string): {
  emoji: string;
  color: StickerColor;
} {
  const p = Number(priceUsdc);
  if (p <= 0) return { emoji: "🎁", color: "green" };
  if (p < 1) return { emoji: "🔧", color: "green" };
  if (p < 3) return { emoji: "🛠️", color: "blue" };
  return { emoji: "⚡", color: "yellow" };
}
