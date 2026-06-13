"use client";

// BottomNav (DESIGN_BRIEF §3) — three Toybox tabs: Make · Discover · Inbox.
// The active tab pops in colour; inactive tabs sit greyed back. The Inbox tab
// carries the unread badge — the app's one retention surface.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui/cx";

interface Tab {
  href: string;
  emoji: string;
  label: string;
  /** also-active prefixes */
  match: (p: string) => boolean;
}

const TABS: Tab[] = [
  { href: "/build", emoji: "⚡", label: "Make", match: (p) => p.startsWith("/build") },
  { href: "/", emoji: "🧸", label: "Discover", match: (p) => p === "/" },
  { href: "/inbox", emoji: "✉️", label: "Inbox", match: (p) => p.startsWith("/inbox") },
];

export function BottomNav({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="flex border-t-2 border-ink bg-card px-2 pt-2.5 pb-7 shrink-0">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="relative flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[44px] no-underline"
          >
            <span
              className={cx(
                "text-xl leading-none",
                !active && "grayscale opacity-50"
              )}
            >
              {tab.emoji}
            </span>
            <span
              className={cx(
                "text-[11.5px]",
                active ? "font-extrabold text-pink" : "font-semibold text-muted"
              )}
            >
              {tab.label}
            </span>
            {tab.label === "Inbox" && unread > 0 && (
              <span className="absolute top-0 right-[26%] flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-pink border-[1.5px] border-ink text-white text-[10px] font-extrabold">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
