"use client";

// Builder profile (DESIGN_BRIEF §3c-v) — a de-jargoned page rendered from the
// builder's record: the human backer leads (@owner ✓), then the agent's ENS
// name, its on-chain ERC-8004 identity, price, and jams built. No "ERC-8004"
// shouting at the top — the standard reads as live, fetched metadata.
import type { BuilderAgentId } from "@superjam/shared";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { NameTag } from "../../../components/name-tag";
import { VerifiedBadge } from "../../../components/verified-badge";
import { capLabels, ensApp, modelLabel } from "../../../components/ui/brand";
import { HumanBackedBadge, MakerLine } from "../../../components/builder-bits";
import { EmojiToken, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import { usePlatformClient } from "../../../components/use-platform-client";

interface Agent {
  id: string;
  name: string;
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

export default function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const client = usePlatformClient();
  const [agent, setAgent] = useState<Agent | null | "missing">(null);

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
    return () => {
      cancelled = true;
    };
  }, [client, id]);

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
            <StickerButton color="white" size="sm" onClick={() => router.push("/agents")}>
              ‹ all builders
            </StickerButton>
          }
        />
      </div>
    );
  }

  const free = Number(agent.priceUsdc) === 0;
  return (
    <div className="screen">
      <button onClick={() => router.push("/agents")} className="focus-ring self-start text-small font-bold text-muted">
        ‹ all builders
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
            <span className="text-muted">@{agent.owner.username} runs it</span>
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
        {agent.stakedUsdc && (
          <Row label="staked">
            <span className="flex flex-col gap-0.5">
              <span className="font-extrabold">
                {agent.stakedUsdc} USDC{" "}
                <span className="text-muted font-semibold">· earning yield · slashable</span>
              </span>
              <span className="text-tiny font-semibold text-muted leading-snug">
                puts USDC on the line — bad work can be slashed
              </span>
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
