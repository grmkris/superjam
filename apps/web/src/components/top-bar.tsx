"use client";

// TopBar — the one uniform header across every chromed route (AppChrome mounts it
// above the scroll region). Left: the SuperJam wordmark on mobile / the page title
// on desktop (the SideNav already carries the wordmark there). Right: the profile
// avatar that opens a Profile / Wallet / Log-out menu — the app's single, always-
// reachable identity surface (replaces the one-off /build header).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "@base-ui-components/react/menu";
import { useLogout } from "@dynamic-labs-sdk/react-hooks";
import { useHostAuth } from "../lib/use-host-auth";
import { useLogin } from "./login";
import { usePlatformClient } from "./use-platform-client";
import { accentFor, avatarEmoji } from "./ui/identity";
import { SparkMark } from "./ui/nav-icons";
import { EmojiToken } from "./ui/sticker";

// Desktop-left page title (mobile shows the wordmark instead). Dynamic routes fall
// back to "" — they carry their own back-button/hero below the bar.
const TITLES: Record<string, string> = {
  "/": "Discover",
  "/build": "Make",
  "/inbox": "Inbox",
  "/me": "Profile",
};

// ProfileControl — the always-reachable identity surface: the avatar+menu when
// signed in, a Log-in button when not. Reused by TopBar and by the feed's
// JamChrome (so the Discover bar carries it inline instead of as an overlay).
export function ProfileControl() {
  const { isLoggedIn, hostUser } = useHostAuth();
  return isLoggedIn && hostUser ? (
    <ProfileMenu username={hostUser.username} />
  ) : (
    <LoginButton />
  );
}

export function TopBar({ overlay = false }: { overlay?: boolean }) {
  const pathname = usePathname() ?? "/";

  const profile = <ProfileControl />;

  // Overlay: float ONLY the profile control over an immersive surface (the Discover
  // feed) — no cream strip, no wordmark — so the feed stays edge-to-edge.
  if (overlay) {
    return <div className="absolute right-0 top-0 z-30 p-3">{profile}</div>;
  }

  return (
    <header className="shrink-0 flex h-14 items-center justify-between gap-2 border-b-[1.5px] border-ink bg-cream px-4">
      {/* mobile → wordmark; desktop → page title (sidebar already brands) */}
      <Link
        href="/"
        className="focus-ring flex items-center gap-1.5 rounded-toy no-underline text-ink lg:hidden"
      >
        <SparkMark aria-hidden />
        <span className="text-h3 font-extrabold tracking-display">SuperJam</span>
      </Link>
      <div className="hidden text-h3 font-extrabold lg:block">
        {TITLES[pathname] ?? ""}
      </div>
      {profile}
    </header>
  );
}

function LoginButton() {
  const { openLogin } = useLogin();
  return (
    <button
      onClick={() => openLogin()}
      className="focus-ring sticker-press shrink-0 rounded-full border-[1.5px] border-ink bg-pink px-4 py-1.5 text-small font-extrabold text-white shadow-sticker-sm"
    >
      Log in
    </button>
  );
}

function ProfileMenu({ username }: { username: string }) {
  const router = useRouter();
  const client = usePlatformClient();
  const { mutate: logOut } = useLogout();
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.payments
      .balance()
      .then((r) => {
        if (!cancelled) setBalance(r.publicUsdc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const avatar = (size: number) => (
    <EmojiToken
      emoji={avatarEmoji(username)}
      color={accentFor(username)}
      size={size}
      rounded="full"
    />
  );

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Your profile menu"
        className="focus-ring sticker-press inline-flex shrink-0 items-center gap-1 rounded-full"
      >
        {avatar(36)}
        <span className="text-small leading-none text-muted">▾</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup
            style={{ transformOrigin: "var(--transform-origin)" }}
            className="animate-pop min-w-[210px] rounded-toy border-[1.5px] border-ink bg-card p-1.5 shadow-sticker-md outline-none"
          >
            <div className="flex items-center gap-2 px-2 py-1.5">
              {avatar(28)}
              <span className="truncate text-body font-extrabold">@{username}</span>
            </div>
            <div className="my-1 h-px bg-ink/10" />
            <MenuItem emoji="👤" label="Profile" onClick={() => router.push("/me")} />
            <MenuItem
              emoji="💸"
              label={`Wallet · ${balance ?? "—"} USDC`}
              onClick={() => router.push("/me")}
            />
            <MenuItem emoji="🚪" label="Log out" onClick={() => logOut()} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MenuItem({
  emoji,
  label,
  onClick,
}: {
  emoji: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-toy px-2 py-2 text-small font-bold text-ink outline-none hover:bg-ink/[0.06] data-[highlighted]:bg-ink/[0.06]"
    >
      <span className="text-base leading-none">{emoji}</span>
      {label}
    </Menu.Item>
  );
}
