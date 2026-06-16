"use client";

// SideNav (desktop ≥lg) — the vertical Toybox rail that replaces the BottomNav
// on wide screens. Same three tabs (Make · Discover · Inbox), same active-pops-
// pink / inactive-greyed styling, same Inbox unread badge. Emoji + label sit
// side by side in a chunky pill; the rail carries the right-side ink border so
// the content column reads as one framed sheet.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, useUnreadCount } from "./bottom-nav";
import { cx } from "./ui/cx";

export function SideNav() {
  const pathname = usePathname() ?? "/";
  const unread = useUnreadCount(pathname);
  return (
    <nav className="hidden lg:flex w-[220px] shrink-0 flex-col gap-2 border-r-2 border-ink bg-cream px-4 pt-6 pb-6">
      {/* wordmark — anchors the rail */}
      <Link
        href="/"
        className="mb-4 px-2 text-h3 font-extrabold text-ink no-underline ink-drop"
      >
        SuperJam
      </Link>
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cx(
              "sticker-press focus-ring relative flex items-center gap-3 rounded-toy border-2 px-4 py-3 no-underline",
              active
                ? "border-ink bg-pink shadow-sticker"
                : "border-transparent bg-transparent"
            )}
          >
            <span
              className={cx(
                "text-xl leading-none transition-transform",
                active ? "scale-110" : "grayscale opacity-50"
              )}
            >
              {tab.emoji}
            </span>
            <span
              className={cx(
                "text-body",
                active ? "font-extrabold text-white" : "font-semibold text-muted"
              )}
            >
              {tab.label}
            </span>
            {tab.label === "Inbox" && unread > 0 && (
              <span
                className={cx(
                  "ml-auto flex h-[20px] min-w-[20px] items-center justify-center rounded-full border-[1.5px] border-ink px-1.5 text-[11px] font-extrabold",
                  // on the active pink pill a pink badge vanishes — flip to ink
                  active ? "bg-ink text-white" : "bg-pink text-white"
                )}
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
