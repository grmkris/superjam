"use client";

// Profile (DESIGN_BRIEF §3f) — behind the @kris ▾ chip. Identity (@name + ENS +
// ✓-human), the Dynamic wallet block (address + USDC balance as the hero
// number), your registered builders, and the World verify block. USDC only — no
// gas / network / token lists.
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NameTag } from "../../components/name-tag";
import { VerifiedBadge } from "../../components/verified-badge";
import { basescan, userEns } from "../../components/ui/brand";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { usePlatformClient } from "../../components/use-platform-client";
import { VerifySheet } from "../../components/verify-sheet";
import { useHostAuth } from "../../lib/use-host-auth";

interface Me {
  username: string;
  ensName: string | null;
  walletAddress: string | null;
  worldVerified: boolean;
}
interface Builder {
  id: string;
  name: string;
  ensName: string | null;
  buildsCount: number;
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ProfilePage() {
  const router = useRouter();
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const { setShowAuthFlow, handleLogOut } = useDynamicContext();

  const [me, setMe] = useState<Me | null>(null);
  const [balance, setBalance] = useState<string | null | "loading">("loading");
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [verifying, setVerifying] = useState(false);

  const loadMe = () =>
    client.profile.me().then((m) =>
      setMe({
        username: m.username,
        ensName: m.ensName,
        walletAddress: m.walletAddress,
        worldVerified: m.worldVerified,
      })
    ).catch(() => {});

  useEffect(() => {
    if (!isLoggedIn) return;
    loadMe();
    client.payments.balance().then((b) => setBalance(b.publicUsdc)).catch(() => setBalance(null));
    client.agents
      .mine()
      .then((rows) =>
        setBuilders(
          rows.map((a) => ({ id: a.id, name: a.name, ensName: a.ensName, buildsCount: a.buildsCount }))
        )
      )
      .catch(() => {});
  }, [client, isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 text-center bg-cream min-h-full">
        <div className="text-5xl">🙂</div>
        <div className="font-extrabold text-xl">sign in to see your profile</div>
        <StickerButton color="pink" size="lg" onClick={() => setShowAuthFlow(true)}>
          Hop in →
        </StickerButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-5 pt-14 pb-6 bg-cream min-h-full">
      {/* identity */}
      <div className="flex items-center gap-3">
        <EmojiToken emoji="🙂" color="green" size={56} rounded="toy" tilt={-5} />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-xl">@{me?.username ?? "you"}</span>
            {me?.worldVerified && <VerifiedBadge variant="pill" />}
          </div>
          <NameTag
            name={me?.ensName ?? userEns(me?.username ?? "you")}
            state={me?.ensName ? "minted" : "pending"}
            href={me?.ensName ? basescan(me.ensName) : undefined}
          />
        </div>
      </div>

      {/* wallet block — USDC balance as the hero number */}
      <StickerCard color="white" className="p-5 flex flex-col gap-1 shadow-sticker-md">
        <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
          your balance
        </div>
        <div className="text-[44px] font-extrabold leading-none">
          {balance === "loading" ? "…" : (balance ?? "0.00")}{" "}
          <span className="text-2xl text-muted">USDC</span>
        </div>
        {me?.walletAddress && (
          <button
            onClick={() => navigator.clipboard?.writeText(me.walletAddress!).catch(() => {})}
            className="self-start mt-1 font-mono text-[12px] font-semibold text-muted"
          >
            {short(me.walletAddress)} 📋
          </button>
        )}
      </StickerCard>

      {/* World verify block */}
      <StickerCard color={me?.worldVerified ? "white" : "cream"} className="p-4 flex items-center gap-3">
        <EmojiToken emoji="🌍" color={me?.worldVerified ? "green" : "yellow"} size={40} rounded="toy" />
        <div className="flex flex-col">
          <div className="font-extrabold text-[15px]">
            {me?.worldVerified ? "Verified human ✓" : "Not verified yet"}
          </div>
          <div className="text-[12px] font-semibold text-muted">
            {me?.worldVerified ? "World ID · one human, one account" : "verify to publish, review & build"}
          </div>
        </div>
        {!me?.worldVerified && (
          <button
            onClick={() => setVerifying(true)}
            className="ml-auto bg-green text-ink border-2 border-ink rounded-full px-3.5 py-2 text-sm font-extrabold shadow-sticker-sm sticker-press"
          >
            Verify
          </button>
        )}
      </StickerCard>

      {/* registered builders */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline">
          <div className="text-[13px] font-extrabold uppercase tracking-wide text-muted">
            your builders
          </div>
          <span className="ml-auto text-[12px] font-bold text-muted">{builders.length}</span>
        </div>
        {builders.length === 0 ? (
          <button
            onClick={() => router.push("/agents/register")}
            className="self-start text-[13px] font-bold text-blue"
          >
            register one →
          </button>
        ) : (
          builders.map((b) => (
            <StickerCard key={b.id} className="p-3.5 flex items-center gap-3">
              <EmojiToken emoji="🛠️" color="blue" size={40} rounded="toy" />
              <div className="flex flex-col min-w-0">
                <div className="font-extrabold text-[15px] truncate">{b.name}</div>
                <div className="text-[12px] font-semibold text-muted">
                  {b.buildsCount.toLocaleString()} jams built
                </div>
              </div>
              {b.ensName && <NameTag name={b.ensName} href={basescan(b.ensName)} className="ml-auto" />}
            </StickerCard>
          ))
        )}
      </div>

      <StickerButton
        color="cream"
        size="md"
        block
        onClick={() => handleLogOut().then(() => router.push("/welcome"))}
        className="mt-2"
      >
        Log out
      </StickerButton>

      <VerifySheet
        open={verifying}
        onClose={() => setVerifying(false)}
        onVerified={loadMe}
        title="Verify you're human"
        blurb="verify once to publish, review & build — one human, one account."
      />
    </div>
  );
}
