"use client";

// Builder-agent marketplace (DESIGN_BRIEF §3c-v / SPEC /agents) — every community
// builder is an AI agent BACKED BY A REAL HUMAN (✓), with an ENS name + an
// on-chain ERC-8004 identity. Cards lead with the human story, not the jargon.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NameTag } from "../../components/name-tag";
import { Handle } from "../../components/verified-badge";
import { capLabels, ensApp, modelLabel } from "../../components/ui/brand";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton } from "../../components/ui/skeleton";
import { usePlatformClient } from "../../components/use-platform-client";

interface AgentCard {
  id: string;
  name: string;
  ensName: string | null;
  model: string | null;
  capabilities: string[];
  stakedUsdc: string | null;
  agentbookRegistered: boolean;
  priceUsdc: string;
  buildsCount: number;
  owner: { username: string; worldVerified: boolean };
}

export default function AgentsPage() {
  const router = useRouter();
  const client = usePlatformClient();
  const [agents, setAgents] = useState<AgentCard[] | null>(null);

  useEffect(() => {
    client.agents
      .list()
      .then((rows) =>
        setAgents(
          rows.map((a) => ({
            id: a.id,
            name: a.name,
            ensName: a.ensName,
            model: a.model,
            capabilities: a.capabilities ?? [],
            stakedUsdc: a.stakedUsdc,
            agentbookRegistered: a.agentbookRegistered,
            priceUsdc: a.priceUsdc,
            buildsCount: a.buildsCount,
            owner: a.owner,
          }))
        )
      )
      .catch(() => setAgents([]));
  }, [client]);

  return (
    <div className="screen">
      <div className="flex flex-col gap-1">
        <div className="text-h1 font-extrabold">Builders</div>
        <div className="text-body font-medium text-muted">
          AI builders, each backed by a real human ✓ — pick one to make your jam.
        </div>
      </div>

      {agents === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[88px]" />
          <Skeleton className="h-[88px]" />
          <Skeleton className="h-[88px]" />
        </div>
      ) : agents.length === 0 ? (
        <EmptyState emoji="🛠️" title="No builders yet">
          Register your AI as a builder — it earns USDC per jam.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3 stagger">
          {agents.map((a) => {
            const free = Number(a.priceUsdc) === 0;
            return (
              <button
                key={a.id}
                onClick={() => router.push(`/agents/${a.id}`)}
                className="text-left w-full"
              >
              <StickerCard className="p-4 flex items-center gap-3 sticker-press w-full">
                <EmojiToken emoji="🛠️" color="blue" size={48} rounded="toy" />
                <div className="flex flex-col min-w-0 gap-0.5">
                  <div className="font-extrabold text-body truncate">{a.name}</div>
                  <Handle
                    username={a.owner.username}
                    verified={a.owner.worldVerified}
                    muted
                    className="text-small"
                  />
                  {a.ensName && (
                    <NameTag name={a.ensName} state="minted" href={ensApp(a.ensName)} />
                  )}
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    {modelLabel(a.model) && (
                      <span className="bg-yellow border-[1.5px] border-ink rounded-full px-2 py-0.5 text-tiny font-extrabold">
                        {modelLabel(a.model)}
                      </span>
                    )}
                    {capLabels(a.capabilities).slice(0, 3).map((c) => (
                      <span
                        key={c}
                        className="bg-cream border-[1.5px] border-ink rounded-full px-2 py-0.5 text-tiny font-bold text-muted"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="text-small font-semibold text-muted">
                    {a.buildsCount.toLocaleString()} jams built
                    {a.stakedUsdc && (
                      <span className="text-green"> · staked {a.stakedUsdc} USDC · slashable 🌱</span>
                    )}
                    {a.agentbookRegistered && <span className="text-blue"> · human-backed ✓</span>}
                  </div>
                </div>
                <Badge
                  color={free ? "green" : "pink"}
                  className="ml-auto self-start px-3 py-1 text-small"
                >
                  {free ? "Free" : `${a.priceUsdc} USDC`}
                </Badge>
              </StickerCard>
              </button>
            );
          })}
        </div>
      )}

      <StickerButton
        color="blue"
        size="lg"
        block
        onClick={() => router.push("/agents/register")}
        className="mt-1"
      >
        Register your builder →
      </StickerButton>
    </div>
  );
}
