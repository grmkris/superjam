"use client";

// SideNav (desktop ≥lg) — the vertical Toybox rail that replaces the BottomNav
// on wide screens. Same three tabs (Make · Discover · Inbox), same active-pops-
// pink / inactive-greyed styling, same Inbox unread badge. Emoji + label sit
// side by side in a chunky pill; the rail carries the right-side ink border so
// the content column reads as one framed sheet.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, useUnreadCount } from "./bottom-nav";
import { SparkMark } from "./ui/nav-icons";
import { cx } from "./ui/cx";

export function SideNav() {
  const pathname = usePathname() ?? "/";
  const unread = useUnreadCount(pathname);
  return (
    <nav className="hidden lg:flex w-[220px] shrink-0 flex-col gap-2 border-r border-line bg-cream px-4 pt-6 pb-6">
      {/* wordmark — anchors the rail */}
      <Link
        href="/"
        className="mb-4 flex items-center gap-1.5 px-2 text-h3 font-extrabold tracking-display text-ink no-underline"
      >
        <SparkMark aria-hidden />
        SuperJam
      </Link>
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const { Icon } = tab;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cx(
              "focus-ring relative flex items-center gap-3 rounded-toy px-3.5 py-2.5 no-underline transition-colors",
              active
                ? "bg-pink/10 text-pink"
                : "text-muted hover:bg-ink/[0.04]"
            )}
          >
            <Icon
              filled={active}
              aria-hidden
              className={cx(
                "size-[22px] shrink-0 transition-colors",
                active ? "text-pink" : "text-faint"
              )}
            />
            <span className={cx("text-body", active ? "font-bold" : "font-semibold")}>
              {tab.label}
            </span>
            {tab.label === "Inbox" && unread > 0 && (
              <span className="ml-auto flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-pink px-1.5 text-[11px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
