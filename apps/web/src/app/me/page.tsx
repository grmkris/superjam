"use client";

// Profile (DESIGN_BRIEF §3f) — behind the @kris ▾ chip. Identity (@name + ENS +
// ✓-human), the Dynamic wallet block (address + USDC balance as the hero
// number), your registered builders, and the World verify block. USDC only — no
// gas / network / token lists.
import type { BuildDraftId } from "@superjam/shared";
import { useLogout } from "@dynamic-labs-sdk/react-hooks";
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
import { useLogin } from "../../components/login";
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
/** A paused wizard draft (pending build) — resumable from where it stopped. */
interface Draft {
  id: string;
  step: string;
  prompt: string;
  name: string | null;
  iconEmoji: string | null;
}
/** A build/jam (running or completed) from apps.mine. */
interface Jam {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
  status: string;
  buildStatus: string | null;
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Feed order within "your jams": running (building) first, then live, then failed.
const jamRank = (j: { status: string; buildStatus: string | null }): number =>
  j.buildStatus === "failed" ? 2 : j.status === "listed" ? 1 : 0;

export default function ProfilePage() {
  const router = useRouter();
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const { openLogin } = useLogin();
  const { mutate: logOut } = useLogout();

  const [me, setMe] = useState<Me | null>(null);
  const [balance, setBalance] = useState<string | null | "loading">("loading");
  const [shielded, setShielded] = useState<string | null | "loading">("loading");
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [jams, setJams] = useState<Jam[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [adding, setAdding] = useState(false);

  const discardDraft = (id: string) => {
    setDrafts((d) => d.filter((x) => x.id !== id));
    client.builds.deleteDraft({ draftId: id as BuildDraftId }).catch(() => {});
  };

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
    client.builds
      .listDrafts()
      .then((d) =>
        setDrafts(
          d.map((x) => ({
            id: x.id,
            step: x.step,
            prompt: x.prompt,
            name: x.name,
            iconEmoji: x.iconEmoji,
          }))
        )
      )
      .catch(() => {});
    client.apps
      .mine()
      .then((r) =>
        setJams(
          r.jams.map((j) => ({
            id: j.id,
            slug: j.slug,
            name: j.name,
            iconEmoji: j.iconEmoji,
            status: j.status,
            buildStatus: j.buildStatus,
          }))
        )
      )
      .catch(() => {});
  }, [client, isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div className="screen items-center justify-center text-center">
        <div className="text-5xl">🙂</div>
        <div className="font-extrabold text-h3">sign in to see your profile</div>
        <StickerButton color="pink" size="lg" onClick={() => openLogin()}>
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

      {/* your jams — pending (drafts) → running (building) → completed (live) */}
      {(drafts.length > 0 || jams.length > 0) && (
        <div className="flex flex-col gap-2">
          <div className="text-small font-extrabold uppercase tracking-wide text-muted">
            your jams
          </div>

          {/* pending — paused wizard drafts, resumable */}
          {drafts.map((d) => (
            <StickerCard key={d.id} color="cream" className="p-3.5 flex items-center gap-3">
              <EmojiToken emoji={d.iconEmoji ?? "✏️"} color="yellow" size={40} rounded="toy" />
              <div className="flex flex-col min-w-0">
                <div className="font-extrabold text-body truncate">
                  {d.name ?? d.prompt ?? "Untitled idea"}
                </div>
                <div className="text-small font-semibold text-muted">draft · paused</div>
              </div>
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => router.push(`/build?d=${d.id}&step=${d.step}`)}
                  className="focus-ring whitespace-nowrap border-2 border-ink rounded-full bg-pink text-white px-3 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
                >
                  Resume →
                </button>
                <button
                  onClick={() => discardDraft(d.id)}
                  aria-label="discard draft"
                  className="focus-ring text-muted font-extrabold px-1.5 text-body"
                >
                  ✕
                </button>
              </div>
            </StickerCard>
          ))}

          {/* running (building) then completed (live) */}
          {[...jams]
            .sort((a, b) => jamRank(a) - jamRank(b))
            .map((j) => {
              const live = j.status === "listed";
              const failed = j.buildStatus === "failed";
              return (
                <StickerCard key={j.id} className="p-3.5 flex items-center gap-3">
                  <EmojiToken
                    emoji={j.iconEmoji}
                    color={live ? "green" : failed ? "pink" : "blue"}
                    size={40}
                    rounded="toy"
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="font-extrabold text-body truncate">{j.name}</div>
                    <div className="text-small font-semibold text-muted">
                      {live ? "live ✓" : failed ? "didn't finish" : "making… ⛏"}
                    </div>
                  </div>
                  {live && (
                    <button
                      onClick={() => router.push(`/app/${j.slug}`)}
                      className="ml-auto shrink-0 focus-ring whitespace-nowrap border-2 border-ink rounded-full bg-green text-ink px-3 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
                    >
                      ▸ Play
                    </button>
                  )}
                </StickerCard>
              );
            })}
        </div>
      )}

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
        onClick={() => logOut(undefined, { onSuccess: () => router.push("/welcome") })}
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
