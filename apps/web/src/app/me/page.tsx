"use client";

// Profile (DESIGN_BRIEF §3f) — behind the @kris ▾ chip. Identity (@name), the
// Dynamic wallet block (address + USDC balance as the hero number), and your
// jams. USDC only — no gas / network / token lists.
import type { AppId, BuildDraftId } from "@superjam/shared";
import { useLogout } from "@dynamic-labs-sdk/react-hooks";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DelegationCard } from "../../components/delegation-card";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { usePlatformClient } from "../../components/use-platform-client";
import { WalletCard } from "../../components/wallet/wallet-card";
import { useLogin } from "../../components/login";
import { useHostAuth } from "../../lib/use-host-auth";

interface Me {
  username: string;
  walletAddress: string | null;
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
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [jams, setJams] = useState<Jam[]>([]);

  const discardDraft = (id: string) => {
    setDrafts((d) => d.filter((x) => x.id !== id));
    client.builds.deleteDraft({ draftId: id as BuildDraftId }).catch(() => {});
  };

  const discardJam = (id: string) => {
    setJams((j) => j.filter((x) => x.id !== id));
    client.apps.discard({ appId: id as AppId }).catch(() => {});
  };

  const loadMe = () =>
    client.profile.me().then((m) =>
      setMe({
        username: m.username,
        walletAddress: m.walletAddress,
      })
    ).catch(() => {});

  useEffect(() => {
    if (!isLoggedIn) return;
    loadMe();
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
      <div className="screen items-center justify-center text-center gap-4">
        <EmojiToken emoji="🙂" color="green" size={72} rounded="toy" />
        <div className="font-extrabold text-h3 tracking-tight">sign in to see your profile</div>
        <StickerButton color="pink" size="lg" onClick={() => openLogin()}>
          Sign in →
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
          <span className="font-extrabold text-h3 tracking-tight">@{me?.username ?? "you"}</span>
        </div>
      </div>

      {/* wallet — a single public USDC balance */}
      <WalletCard walletAddress={me?.walletAddress ?? null} />

      {/* delegated access — let the server sign on your behalf (payments + agents) */}
      <DelegationCard />

      {/* your jams — pending (drafts) → running (building) → completed (live) */}
      {(drafts.length > 0 || jams.length > 0) && (
        <div className="flex flex-col gap-2 stagger">
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
                  className="focus-ring whitespace-nowrap border-[1.5px] border-ink rounded-full bg-pink text-white px-3 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
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
                      {live ? "live ✓" : failed ? "didn't finish" : "making…"}
                    </div>
                  </div>
                  {live ? (
                    <button
                      onClick={() => router.push(`/app/${j.slug}`)}
                      className="ml-auto shrink-0 focus-ring whitespace-nowrap border-[1.5px] border-ink rounded-full bg-green text-ink px-3 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
                    >
                      ▸ Play
                    </button>
                  ) : (
                    // Non-live (making… / didn't finish) — let the owner clear it.
                    <button
                      onClick={() => discardJam(j.id)}
                      aria-label={`Remove ${j.name}`}
                      className="ml-auto shrink-0 focus-ring text-muted font-extrabold px-1.5 text-body"
                    >
                      ✕
                    </button>
                  )}
                </StickerCard>
              );
            })}
        </div>
      )}

      <StickerButton
        color="cream"
        size="md"
        block
        onClick={() => logOut(undefined, { onSuccess: () => router.push("/welcome") })}
        className="mt-2"
      >
        Log out
      </StickerButton>
    </div>
  );
}
