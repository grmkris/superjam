// VerifiedBadge — the green ✓-human sticker (DESIGN_BRIEF §2, World ID). The
// social atom: every @username carries one. Two shapes:
//   dot   a tiny green ✓ circle that sits right after a handle
//   pill  an ink "✓ human" pill for headers / review rows
import { cx } from "./ui/cx";

export function VerifiedBadge({
  variant = "dot",
  label = "human",
  className,
}: {
  variant?: "dot" | "pill";
  label?: string;
  className?: string;
}) {
  if (variant === "pill") {
    return (
      <span
        className={cx(
          "inline-flex items-center gap-1 bg-ink text-white rounded-full px-2 py-0.5 text-[10px] font-extrabold",
          className
        )}
      >
        ✓ {label}
      </span>
    );
  }
  return (
    <span
      aria-label="verified human"
      className={cx(
        "inline-flex items-center justify-center bg-green border-[1.5px] border-ink rounded-full",
        "w-[15px] h-[15px] text-[8.5px] font-extrabold text-ink shrink-0",
        className
      )}
    >
      ✓
    </span>
  );
}

/** @handle + ✓ together — the recurring identity unit. */
export function Handle({
  username,
  verified,
  className,
  muted,
}: {
  username: string;
  verified?: boolean;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span className={cx("inline-flex items-center gap-1.5", className)}>
      <span className={cx("font-bold", muted && "text-muted font-semibold")}>
        @{username}
      </span>
      {verified && <VerifiedBadge />}
    </span>
  );
}
