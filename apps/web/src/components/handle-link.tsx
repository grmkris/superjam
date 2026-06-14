"use client";

// HandleLink — a tappable @handle that routes to the owner's /u/<username> profile.
// The clickable sibling of <Handle> (verified-badge.tsx): same @name + ✓ unit, but
// wrapped in a Link. Falls back to a plain <Handle> for empty / placeholder names
// (e.g. the feed's "maker" stand-in) so we never link to /u/maker. Use this anywhere
// a handle is rendered OUTSIDE another <a>/<button> (nesting interactive elements is
// invalid HTML); inside a clickable row, keep plain text.
import Link from "next/link";
import { cx } from "./ui/cx";
import { Handle, VerifiedBadge } from "./verified-badge";

export function HandleLink({
  username,
  verified,
  muted,
  className,
}: {
  username: string;
  verified?: boolean;
  muted?: boolean;
  className?: string;
}) {
  if (!username || username === "maker") {
    return (
      <Handle
        username={username}
        verified={verified}
        muted={muted}
        className={className}
      />
    );
  }
  return (
    <Link
      href={`/u/${username}`}
      className={cx(
        "focus-ring inline-flex items-center gap-1.5 sticker-press hover:underline",
        className
      )}
    >
      <span className={cx("font-bold", muted && "text-muted font-semibold")}>
        @{username}
      </span>
      {verified && <VerifiedBadge />}
    </Link>
  );
}
