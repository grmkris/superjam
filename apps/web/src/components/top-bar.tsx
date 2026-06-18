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
import { EmojiToken } from "./ui/sticker";

// Desktop-left page title (mobile shows the wordmark instead). Dynamic routes fall
// back to "" — they carry their own back-button/hero below the bar.
const TITLES: Record<string, string> = {
  "/": "Discover",
  "/build": "Make",
  "/inbox": "Inbox",
  "/me": "Profile",
  "/agents": "Builders",
};

export function TopBar() {
  const pathname = usePathname() ?? "/";
  const { isLoggedIn, hostUser } = useHostAuth();

  return (
    <header className="shrink-0 flex h-14 items-center justify-between gap-2 border-b-2 border-ink bg-cream px-4">
      {/* mobile → wordmark; desktop → page title (sidebar already brands) */}
      <Link
        href="/"
        className="focus-ring flex items-center gap-1.5 rounded-toy no-underline text-ink lg:hidden"
      >
        <span className="text-xl leading-none">⚡</span>
        <span className="text-h3 font-extrabold ink-drop">SuperJam</span>
      </Link>
      <div className="hidden text-h3 font-extrabold lg:block">
        {TITLES[pathname] ?? ""}
      </div>

      {isLoggedIn && hostUser ? (
        <ProfileMenu username={hostUser.username} />
      ) : (
        <LoginButton />
      )}
    </header>
  );
}

function LoginButton() {
  const { openLogin } = useLogin();
  return (
    <button
      onClick={() => openLogin()}
      className="focus-ring sticker-press shrink-0 rounded-full border-2 border-ink bg-pink px-4 py-1.5 text-small font-extrabold text-white shadow-sticker-sm"
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
          <Menu.Popup className="animate-pop min-w-[210px] rounded-toy border-2 border-ink bg-cream p-1.5 shadow-sticker outline-none">
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
