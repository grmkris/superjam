"use client";

// BottomNav (DESIGN_BRIEF §3) — three Toybox tabs: Make · Discover · Inbox.
// The active tab pops in colour; inactive tabs sit greyed back. The Inbox tab
// carries the unread badge — the app's one retention surface.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useHostAuth } from "../lib/use-host-auth";
import { usePlatformClient } from "./use-platform-client";
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

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const unread = useUnreadCount(pathname);
  return (
    <nav className="flex border-t-2 border-ink bg-card px-2 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shrink-0">
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
                "text-xl leading-none transition-transform",
                active ? "scale-110" : "grayscale opacity-50"
              )}
            >
              {tab.emoji}
            </span>
            <span
              className={cx(
                "text-tiny",
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

// Unread badge count — the retention surface. Refetches on route change (so
// leaving /inbox after mark-all-read clears it) and on window focus.
function useUnreadCount(pathname: string): number {
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!isLoggedIn) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    const refresh = () =>
      Promise.all([client.inbox.list(), client.chat.threads()])
        .then(([inbox, chat]) => {
          if (!cancelled) setUnread(inbox.unread + chat.totalUnread);
        })
        .catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [client, isLoggedIn, pathname]);

  return unread;
}
