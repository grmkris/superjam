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
import { ensApp, userEns } from "../../components/ui/brand";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { Skeleton } from "../../components/ui/skeleton";
import { usePlatformClient } from "../../components/use-platform-client";
import { VerifySheet } from "../../components/verify-sheet";
import { AddFundsSheet } from "../../components/add-funds-sheet";
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
  const [shielded, setShielded] = useState<string | null | "loading">("loading");
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [adding, setAdding] = useState(false);

  const loadShielded = () =>
    client.payments
      .privateBalance()
      .then((b) => setShielded(b.shieldedUsdc))
      .catch(() => setShielded(null));

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
    loadShielded();
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
      <div className="screen items-center justify-center text-center">
        <div className="text-5xl">🙂</div>
        <div className="font-extrabold text-h3">sign in to see your profile</div>
        <StickerButton color="pink" size="lg" onClick={() => setShowAuthFlow(true)}>
          Hop in →
        </StickerButton>
      </div>
    );
  }

  return (
    <div className="screen">
      {/* identity */}
      <div className="flex items-center gap-3">
        <EmojiToken emoji="🙂" color="green" size={56} rounded="toy" tilt={-5} />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-h3">@{me?.username ?? "you"}</span>
            {me?.worldVerified && <VerifiedBadge variant="pill" />}
          </div>
          <NameTag
            name={me?.ensName ?? userEns(me?.username ?? "you")}
            state={me?.ensName ? "minted" : "pending"}
            href={me?.ensName ? ensApp(me.ensName) : undefined}
          />
        </div>
      </div>

      {/* wallet block — the SHIELDED (private) balance is the in-app wallet (hero);
          public on-chain USDC is the secondary on/off-ramp line. */}
      <StickerCard color="white" className="p-5 flex flex-col gap-1 shadow-sticker-md">
        <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
          your balance · private 🔒
        </div>
        {shielded === "loading" ? (
          <Skeleton className="mt-1 h-11 w-44" />
        ) : (
          <div className="text-hero font-extrabold">
            {shielded ?? "0.00"}{" "}
            <span className="text-2xl text-muted">USDC</span>
          </div>
        )}
        <div className="text-small font-semibold text-muted">
          {balance === "loading" ? "…" : `${balance ?? "0.00"} USDC on-chain (public)`}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <StickerButton
            color="green"
            size="sm"
            onClick={() => setAdding(true)}
            className="rounded-full"
          >
            + Add funds
          </StickerButton>
          {me?.walletAddress && (
            <button
              onClick={() => navigator.clipboard?.writeText(me.walletAddress!).catch(() => {})}
              className="focus-ring font-mono text-small font-semibold text-muted"
            >
              {short(me.walletAddress)} 📋
            </button>
          )}
        </div>
      </StickerCard>

      {/* World verify block */}
      <StickerCard color={me?.worldVerified ? "white" : "cream"} className="p-4 flex items-center gap-3">
        <EmojiToken emoji="🌍" color={me?.worldVerified ? "green" : "yellow"} size={40} rounded="toy" />
        <div className="flex flex-col">
          <div className="font-extrabold text-body">
            {me?.worldVerified ? "Verified human ✓" : "Not verified yet"}
          </div>
          <div className="text-small font-semibold text-muted">
            {me?.worldVerified ? "World ID · one human, one account" : "verify to publish, review & build"}
          </div>
        </div>
        {!me?.worldVerified && (
          <StickerButton
            color="green"
            size="sm"
            onClick={() => setVerifying(true)}
            className="ml-auto rounded-full"
          >
            Verify
          </StickerButton>
        )}
      </StickerCard>

      {/* registered builders */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline">
          <div className="text-small font-extrabold uppercase tracking-wide text-muted">
            your builders
          </div>
          <span className="ml-auto text-small font-bold text-muted">{builders.length}</span>
        </div>
        {builders.length === 0 ? (
          <button
            onClick={() => router.push("/agents/register")}
            className="focus-ring self-start text-small font-bold text-blue"
          >
            register one →
          </button>
        ) : (
          builders.map((b) => (
            <StickerCard key={b.id} className="p-3.5 flex items-center gap-3">
              <EmojiToken emoji="🛠️" color="blue" size={40} rounded="toy" />
              <div className="flex flex-col min-w-0">
                <div className="font-extrabold text-body truncate">{b.name}</div>
                <div className="text-small font-semibold text-muted">
                  {b.buildsCount.toLocaleString()} jams built
                </div>
              </div>
              {b.ensName && <NameTag name={b.ensName} href={ensApp(b.ensName)} className="ml-auto" />}
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

      <AddFundsSheet
        open={adding}
        onClose={() => setAdding(false)}
        onFunded={(shieldedUsdc) => {
          if (shieldedUsdc !== undefined) setShielded(shieldedUsdc);
          loadShielded();
        }}
      />
    </div>
  );
}
