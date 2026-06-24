"use client";

// AppChrome — decides the frame around each route. Front-of-house product
// routes (Discover / Make / Inbox / Profile) live inside the Toybox phone
// column with the bottom tab bar. The onboarding flow and the full-bleed jam
// viewer (%67's /app/[slug]) get no chrome at all.
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { SideNav } from "./side-nav";
import { TopBar } from "./top-bar";

const FULL_BLEED = (p: string): boolean =>
  p === "/welcome" || p.startsWith("/app/");

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  if (FULL_BLEED(pathname)) {
    return <>{children}</>;
  }

  // The Discover feed is edge-to-edge immersive — no page-level bar. Its profile
  // avatar + app actions live in the per-jam JamChrome bar (the feed's own bar).
  const immersive = pathname === "/";

  return (
    // mobile: vertical column with the bottom tab bar. desktop (lg): a left
    // SideNav rail beside the content column (has-sidenav drops the doubled
    // left ink border — the rail draws it). BottomNav hides on lg.
    <div className="app-shell has-sidenav flex flex-col lg:flex-row h-[100dvh] overflow-hidden">
      <SideNav />
      <main className="relative flex flex-1 min-h-0 flex-col">
        {immersive ? (
          <div key={pathname} className="flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        ) : (
          <>
            <TopBar />
            <div
              key={pathname}
              className="flex-1 min-h-0 overflow-y-auto motion-safe:animate-[fadein_0.2s_ease-out]"
            >
              {children}
            </div>
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
