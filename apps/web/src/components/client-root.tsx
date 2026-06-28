"use client";

// ClientRoot — the client boundary for the whole app.
//
// SuperJam is a wallet SPA: every route lives under Dynamic's
// DynamicContextProvider (%67's <Providers>), and that provider is client-only —
// it throws if rendered on the server (static export OR request-time SSR alike).
// So the provider, and therefore the app under it, mounts on the client. This is
// the standard shape for embedded-wallet apps (RainbowKit/wagmi/Dynamic all do
// it). The gate must sit ABOVE <Providers> — gating anything below it still lets
// the provider server-render and throw.
//
// A brief branded splash covers the mount so there's no flash of empty page.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useHostAuth } from "../lib/use-host-auth";
import { AppChrome } from "./app-chrome";
import { ConfirmProvider } from "./confirm/confirm-provider";
import { useRelayExecutor } from "./confirm/pay-executor";
import { Providers } from "./providers";
import { Toaster } from "./toast/toaster";

export function ClientRoot({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <Splash />;

  return (
    <Providers>
      <AuthGate>
        <WiredConfirm>
          <AppChrome>{children}</AppChrome>
        </WiredConfirm>
      </AuthGate>
      {/* Host toasts (jam share feedback + sdk.ui.toast) render above everything. */}
      <Toaster />
    </Providers>
  );
}

// The only route a signed-out viewer may see — everything else requires login.
const isPublic = (p: string): boolean => p === "/welcome";

// AuthGate — the login wall. Signed-out viewers can't see or touch anything but
// /welcome; we bounce them there with a ?next= so they return to where they were
// headed after signing in. While Dynamic is still resolving auth (meStatus
// "pending") we hold the splash rather than flash a redirect. An "error" viewer
// still holds a token (isLoggedIn true) and passes through.
function AuthGate({ children }: { children: ReactNode }) {
  const { isLoggedIn, meStatus } = useHostAuth();
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  const resolving = meStatus === "pending";
  const blocked = !resolving && !isLoggedIn && !isPublic(pathname);

  useEffect(() => {
    if (!blocked) return;
    const here = window.location.pathname + window.location.search;
    const q = here === "/" ? "" : `?next=${encodeURIComponent(here)}`;
    router.replace(`/welcome${q}`);
  }, [blocked, router]);

  if (resolving || blocked) return <Splash />;
  return <>{children}</>;
}

// Inside <Providers> so useRelayExecutor can reach the Dynamic wallet; injects
// the real sign+relay executor into the confirm sheet.
function WiredConfirm({ children }: { children: ReactNode }) {
  const executor = useRelayExecutor();
  return <ConfirmProvider executor={executor}>{children}</ConfirmProvider>;
}

function Splash() {
  // Full-viewport (NOT .app-shell — that pins to the 460px phone column + side
  // borders, which looks like a narrow mobile frame on desktop before AppChrome's
  // desktop layout mounts). Just a centered branded sticker on cream, every width.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-cream">
      <span
        className="flex h-20 w-20 items-center justify-center rounded-[22px] border-[2.5px] border-ink bg-yellow text-4xl shadow-sticker-lg animate-pulse"
        style={{ transform: "rotate(-6deg)" }}
      >
        ⚡
      </span>
    </div>
  );
}
