"use client";

// BottomNav — three tabs: Make · Discover · Inbox. Crisp line icons that colour
// in (pink) when active and sit muted otherwise. The Inbox tab carries the
// unread badge — the app's one retention surface.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { useHostAuth } from "../lib/use-host-auth";
import { usePlatformClient } from "./use-platform-client";
import { cx } from "./ui/cx";
import { DiscoverIcon, InboxIcon, MakeIcon } from "./ui/nav-icons";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { filled?: boolean }>;

export interface Tab {
  href: string;
  Icon: NavIcon;
  label: string;
  /** also-active prefixes */
  match: (p: string) => boolean;
}

// The three tabs — shared by BottomNav (mobile) and SideNav (desktop).
export const TABS: Tab[] = [
  { href: "/build", Icon: MakeIcon, label: "Make", match: (p) => p.startsWith("/build") },
  { href: "/", Icon: DiscoverIcon, label: "Discover", match: (p) => p === "/" },
  { href: "/inbox", Icon: InboxIcon, label: "Inbox", match: (p) => p.startsWith("/inbox") },
];

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const unread = useUnreadCount(pathname);
  return (
    <nav className="flex lg:hidden border-t border-line bg-card px-2 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shrink-0">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const { Icon } = tab;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="focus-ring relative flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px] rounded-toy no-underline"
          >
            {/* icon wrapper anchors the unread badge — no magic offsets */}
            <span className="relative inline-flex">
              <Icon
                filled={active}
                aria-hidden
                className={cx(
                  "size-[22px] transition-[color,transform] duration-200 ease-out",
                  active ? "scale-105 text-pink" : "text-faint"
                )}
              />
              {tab.label === "Inbox" && unread > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border border-line bg-pink px-1 text-[10px] font-extrabold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </span>
            <span
              className={cx(
                "text-tiny tracking-tight",
                active ? "font-extrabold text-pink" : "font-semibold text-muted"
              )}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// Unread badge count — the retention surface. Refetches on route change (so
// leaving /inbox after mark-all-read clears it) and on window focus. Exported so
// SideNav (desktop) can carry the same badge.
export function useUnreadCount(pathname: string): number {
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
