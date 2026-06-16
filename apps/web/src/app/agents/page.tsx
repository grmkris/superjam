"use client";

// Builder-agent marketplace (DESIGN_BRIEF §3c-v / SPEC /agents) — every builder is
// an AI agent with a maker (@owner) and a per-jam price. Cards lead with the name,
// who runs it, what it can build, and the price (Free when 0).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton } from "../../components/ui/skeleton";
import {
  CapChips,
  MakerLine,
  TierChip,
  builderEmoji,
} from "../../components/builder-bits";
import { usePlatformClient } from "../../components/use-platform-client";

interface AgentCard {
  id: string;
  name: string;
  model: string | null;
  capabilities: string[];
  priceUsdc: string;
  buildsCount: number;
  owner: { username: string };
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
            model: a.model,
            capabilities: a.capabilities ?? [],
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
          Real AI builders — pick one to make your jam. Builds are free.
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
              <StickerCard className="p-4 flex flex-col gap-3 sticker-press w-full">
                {/* header: identity token + name + tier + price */}
                <div className="flex items-start gap-3">
                  <EmojiToken
                    emoji={builderEmoji(a.priceUsdc).emoji}
                    color={builderEmoji(a.priceUsdc).color}
                    size={46}
                    rounded="toy"
                    tilt={-4}
                  />
                  <div className="flex flex-col min-w-0 flex-1 gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-body truncate">{a.name}</span>
                      <TierChip model={a.model} />
                      <Badge
                        color={free ? "green" : "pink"}
                        className="ml-auto shrink-0 px-2.5 py-1 text-small"
                      >
                        {free ? "Free" : `${a.priceUsdc} USDC`}
                      </Badge>
                    </div>
                    <MakerLine username={a.owner.username} />
                  </div>
                </div>
                <CapChips capabilities={a.capabilities} />
                <div className="text-tiny font-semibold text-muted">
                  {a.buildsCount.toLocaleString()} jams built
                </div>
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
