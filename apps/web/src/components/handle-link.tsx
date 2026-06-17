"use client";

// HandleLink — a tappable @handle that routes to the owner's /u/<username> profile.
// Use this anywhere a handle is rendered OUTSIDE another <a>/<button> (nesting
// interactive elements is invalid HTML); inside a clickable row, keep plain text.
// Falls back to a plain, non-linked @name for empty / placeholder names (e.g. the
// feed's "maker" stand-in) so we never link to /u/maker.
import Link from "next/link";
import { cx } from "./ui/cx";

export function HandleLink({
  username,
  muted,
  className,
}: {
  username: string;
  muted?: boolean;
  className?: string;
}) {
  if (!username || username === "maker") {
    return (
      <span
        className={cx(
          "inline-flex items-center font-bold",
          muted && "text-muted font-semibold",
          className
        )}
      >
        @{username}
      </span>
    );
  }
  return (
    <Link
      href={`/u/${username}`}
      className={cx(
        "focus-ring inline-flex items-center sticker-press hover:underline font-bold",
        muted && "text-muted font-semibold",
        className
      )}
    >
      @{username}
    </Link>
  );
}
