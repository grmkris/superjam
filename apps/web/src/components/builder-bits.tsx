// Builder-card building blocks — shared by the make-flow picker, the /agents
// marketplace list, and the /agents/[id] profile so all three read identically.
// The point of this file is the TWO-MARK TRUST SYSTEM (DESIGN_BRIEF §3c-v): two
// different "verified" facts that must NEVER look like the same badge —
//   • MakerLine        → the agent's OWNER is a World-verified human (green ✓ dot).
//                        True for every fleet agent (they share @superjam). "who runs it."
//   • HumanBackedBadge → the agent's WALLET is registered in World AgentBook to a
//                        unique human (blue 🌐 pill). Per-agent, rare. "a human is bonded to THIS one."
import { cx } from "./ui/cx";
import { VerifiedBadge } from "./verified-badge";
import { capLabels, modelLabel } from "./ui/brand";
import type { StickerColor } from "./ui/sticker";

/** World AgentBook human-backed pill. Deliberately a BLUE 🌐 pill — visually
 *  unlike the green ✓ maker dot — so "human-backed" can't be confused with the
 *  owner's verification. Only render when the agent's wallet is actually registered. */
export function HumanBackedBadge({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 bg-blue text-white border-2 border-ink rounded-full font-extrabold whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-tiny" : "px-2.5 py-1 text-small",
        className
      )}
    >
      <span aria-hidden>🌐</span> human-backed
    </span>
  );
}

/** "made by @owner ✓" — the maker/operator. The ✓ is the OWNER's World ID, not the
 *  agent's AgentBook backing. Muted so it reads as attribution, not a trust trophy. */
export function MakerLine({
  username,
  worldVerified,
  className,
}: {
  username: string;
  worldVerified: boolean;
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
      {worldVerified && <VerifiedBadge />}
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

/** The per-agent trust row: the slashable stake + (only when registered) the
 *  human-backed pill. These are the signals that actually differ between agents. */
export function TrustRow({
  stakedUsdc,
  agentbookRegistered,
  className,
}: {
  stakedUsdc: string | null;
  agentbookRegistered: boolean;
  className?: string;
}) {
  if (!stakedUsdc && !agentbookRegistered) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", className)}>
      {stakedUsdc && (
        <span className="inline-flex items-center gap-1 bg-green border-2 border-ink rounded-full px-2 py-0.5 text-tiny font-extrabold text-ink whitespace-nowrap">
          <span aria-hidden>🌱</span> {stakedUsdc} staked · slashable
        </span>
      )}
      {agentbookRegistered && <HumanBackedBadge />}
    </div>
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
