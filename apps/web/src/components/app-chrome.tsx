"use client";

// AppChrome — decides the frame around each route. Front-of-house product
// routes (Discover / Make / Inbox / Profile) live inside the Toybox phone
// column with the bottom tab bar. The onboarding flow and the full-bleed jam
// viewer (%67's /app/[slug]) get no chrome at all.
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";

const FULL_BLEED = (p: string): boolean =>
  p === "/welcome" || p.startsWith("/app/");

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  if (FULL_BLEED(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell flex flex-col h-[100dvh] overflow-hidden">
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      <BottomNav />
    </div>
  );
}
