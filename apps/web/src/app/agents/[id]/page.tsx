"use client";

// Builder profile (DESIGN_BRIEF §3c-v) — a de-jargoned page rendered from the
// builder's record: the human backer leads (@owner ✓), then the agent's ENS
// name, its on-chain ERC-8004 identity, price, and jams built. No "ERC-8004"
// shouting at the top — the standard reads as live, fetched metadata.
import type { BuilderAgentId } from "@superjam/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useState } from "react";
import { NameTag } from "../../../components/name-tag";
import { VerifiedBadge } from "../../../components/verified-badge";
import { HandleLink } from "../../../components/handle-link";
import { capLabels, ensApp, modelLabel } from "../../../components/ui/brand";
import { HumanBackedBadge, MakerLine } from "../../../components/builder-bits";
import { EmojiToken, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import { StakeSheet } from "../../../components/stake-sheet";
import { usePlatformClient } from "../../../components/use-platform-client";
import { useHostAuth } from "../../../lib/use-host-auth";

interface Agent {
  id: string;
  name: string;
  ownerUserId: string;
  ensName: string | null;
  model: string | null;
  erc8004Id: string | null;
  stakedUsdc: string | null;
  agentbookRegistered: boolean;
  priceUsdc: string;
  buildsCount: number;
  walletAddress: string;
  capabilities: string[];
  owner: { username: string; worldVerified: boolean };
}

interface StakeInfo {
  stakedUsdc: string | null;
  poolYieldUsdc: string | null;
  live: boolean;
}

export default function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // useSearchParams (below) requires a Suspense boundary or `next build` fails on
  // prerender — same wrapper pattern as the Make page.
  return (
    <Suspense fallback={<div className="screen"><Skeleton className="h-28" /></div>}>
      <AgentProfile params={params} />
    </Suspense>
  );
}

function AgentProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  // When opened from the build flow (BuilderBeat "Profile"), back returns to the
  // jam at the builder step instead of the /agents marketplace index — otherwise
  // the user gets dumped on /agents and loses their place in the build.
  const sp = useSearchParams();
  const fromDraft = sp.get("from") === "build" ? sp.get("d") : null;
  const backTo = fromDraft ? `/build?d=${fromDraft}&step=builder` : "/agents";
  const backLabel = fromDraft ? "‹ back to your jam" : "‹ all builders";
  const client = usePlatformClient();
  const { hostUser } = useHostAuth();
  const [agent, setAgent] = useState<Agent | null | "missing">(null);
  const [stake, setStake] = useState<StakeInfo | null>(null);
  const [stakeOpen, setStakeOpen] = useState(false);

  // Live on-chain stake + pool yield (the trust badge made real). Best-effort.
  const loadStake = useCallback(() => {
    client.agents
      .stakeInfo({ agentId: id as BuilderAgentId })
      .then((s) => setStake(s))
      .catch(() => {});
  }, [client, id]);

  useEffect(() => {
    let cancelled = false;
    client.agents
      .get({ agentId: id as BuilderAgentId })
      .then((a) => {
        if (!cancelled) setAgent(a as Agent);
      })
      .catch(() => {
        if (!cancelled) setAgent("missing");
      });
    loadStake();
    return () => {
      cancelled = true;
    };
  }, [client, id, loadStake]);

  if (agent === null) {
    return (
      <div className="screen">
        <Skeleton className="h-28" />
        <Skeleton className="h-20" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (agent === "missing") {
    return (
      <div className="screen items-center justify-center">
        <EmptyState
          emoji="🛠️"
          title="builder not found"
          emojiColor="blue"
          action={
            <StickerButton color="white" size="sm" onClick={() => router.push(backTo)}>
              {backLabel}
            </StickerButton>
          }
        />
      </div>
    );
  }

  const free = Number(agent.priceUsdc) === 0;
  const isOwner = Boolean(hostUser && hostUser.id === agent.ownerUserId);
  // Prefer the live on-chain read; fall back to the registration snapshot.
  const stakedUsdc = stake?.stakedUsdc ?? agent.stakedUsdc;
  const poolYieldUsdc = stake?.poolYieldUsdc ?? null;
  return (
    <div className="screen">
      <button onClick={() => router.push(backTo)} className="focus-ring self-start text-small font-bold text-muted">
        {backLabel}
      </button>

      <div className="flex items-center gap-3">
        <EmojiToken emoji="🛠️" color="blue" size={56} rounded="toy" tilt={-5} />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="font-extrabold text-h2 truncate">{agent.name}</div>
          <MakerLine username={agent.owner.username} worldVerified={agent.owner.worldVerified} />
        </div>
      </div>

      {/* the record — fetched, de-jargoned */}
      <StickerCard color="white" className="p-5 flex flex-col gap-3 shadow-sticker-md">
        {agent.ensName && (
          <Row label="name">
            <NameTag name={agent.ensName} state="minted" href={ensApp(agent.ensName)} />
          </Row>
        )}
        <Row label="maker">
          <span className="inline-flex flex-wrap items-center gap-2 text-small font-semibold">
            <VerifiedBadge variant="pill" label={agent.owner.worldVerified ? "verified human" : "unverified"} />
            <span className="text-muted">
              <HandleLink username={agent.owner.username} className="text-muted" /> runs it
            </span>
          </span>
        </Row>
        {modelLabel(agent.model) && (
          <Row label="brain">
            <span className="bg-yellow border-2 border-ink rounded-full px-2.5 py-0.5 text-small font-extrabold">
              {modelLabel(agent.model)}
            </span>
          </Row>
        )}
        {capLabels(agent.capabilities).length > 0 && (
          <Row label="can build">
            <span className="flex flex-wrap gap-1.5">
              {capLabels(agent.capabilities).map((c) => (
                <span
                  key={c}
                  className="bg-cream border-2 border-ink rounded-full px-2.5 py-0.5 text-small font-bold text-muted"
                >
                  {c}
                </span>
              ))}
            </span>
          </Row>
        )}
        {agent.erc8004Id && (
          <Row label="identity">
            <span className="inline-flex items-center gap-1.5 text-small font-bold">
              <span className="bg-green border-[1.5px] border-ink rounded-full size-[15px] inline-flex items-center justify-center text-[8.5px]">
                ✓
              </span>
              registered on-chain · #{agent.erc8004Id}
            </span>
          </Row>
        )}
        {agent.agentbookRegistered && (
          <Row label="human-backed">
            <span className="inline-flex flex-wrap items-center gap-2 text-small font-semibold">
              <HumanBackedBadge size="md" />
              <span className="text-muted">via World AgentBook</span>
            </span>
          </Row>
        )}
        {(stakedUsdc || isOwner) && (
          <Row label="staked">
            <span className="flex flex-col gap-0.5">
              <span className="font-extrabold">
                {stakedUsdc ?? "0"} USDC{" "}
                <span className="text-muted font-semibold">· earning yield · slashable</span>
              </span>
              {poolYieldUsdc && Number(poolYieldUsdc) > 0 && (
                <span className="text-tiny font-bold text-green-ink leading-snug">
                  🌱 pool earning {poolYieldUsdc} USDC yield
                </span>
              )}
              <span className="text-tiny font-semibold text-muted leading-snug">
                puts USDC on the line — bad work can be slashed
              </span>
              {isOwner && (
                <button
                  onClick={() => setStakeOpen(true)}
                  className="focus-ring self-start mt-1 border-2 border-ink rounded-full bg-green text-ink px-3 py-1 text-tiny font-extrabold shadow-sticker-sm sticker-press"
                >
                  + Top up stake
                </button>
              )}
            </span>
          </Row>
        )}
        <Row label="jams built">
          <span className="font-extrabold">{agent.buildsCount.toLocaleString()}</span>
        </Row>
        <Row label="price">
          <span className="font-extrabold">{free ? "Free" : `${agent.priceUsdc} USDC / jam`}</span>
        </Row>
      </StickerCard>

      <StickerButton color="pink" size="lg" block onClick={() => router.push("/build")}>
        Make a jam with {agent.name} →
      </StickerButton>

      {isOwner && (
        <StakeSheet
          open={stakeOpen}
          onClose={() => setStakeOpen(false)}
          agentId={agent.id}
          agentName={agent.name}
          onStaked={(s) => {
            // optimistic, then re-read the live stake
            setStake((prev) => (prev ? { ...prev, stakedUsdc: s } : prev));
            loadStake();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-tiny font-extrabold uppercase tracking-wide text-muted w-[84px] shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}
