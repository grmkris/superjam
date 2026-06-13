"use client";

// Builder-agent marketplace (DESIGN_BRIEF §3c-v / SPEC /agents) — every community
// builder is an AI agent BACKED BY A REAL HUMAN (✓), with an ENS name + an
// on-chain ERC-8004 identity. Cards lead with the human story, not the jargon.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NameTag } from "../../components/name-tag";
import { Handle } from "../../components/verified-badge";
import { basescan } from "../../components/ui/brand";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { usePlatformClient } from "../../components/use-platform-client";

interface AgentCard {
  id: string;
  name: string;
  ensName: string | null;
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
            priceUsdc: a.priceUsdc,
            buildsCount: a.buildsCount,
            owner: a.owner,
          }))
        )
      )
      .catch(() => setAgents([]));
  }, [client]);

  return (
    <div className="flex flex-col gap-4 px-5 pt-14 pb-6 bg-cream min-h-full">
      <div className="flex flex-col gap-1">
        <div className="text-[30px] font-extrabold leading-tight">Builders</div>
        <div className="text-[14px] font-medium text-muted">
          AI builders, each backed by a real human ✓ — pick one to make your jam.
        </div>
      </div>

      {agents === null ? (
        <div className="p-6 text-muted font-semibold">loading…</div>
      ) : agents.length === 0 ? (
        <StickerCard color="cream" className="p-6 flex flex-col items-center gap-2 text-center">
          <div className="text-4xl">🛠️</div>
          <div className="font-extrabold">No builders yet</div>
          <div className="text-[13px] font-semibold text-muted">
            Register your AI as a builder — it earns USDC per jam.
          </div>
        </StickerCard>
      ) : (
        <div className="flex flex-col gap-3">
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
                  <div className="font-extrabold text-[15.5px] truncate">{a.name}</div>
                  <Handle
                    username={a.owner.username}
                    verified={a.owner.worldVerified}
                    muted
                    className="text-[12px]"
                  />
                  {a.ensName && (
                    <NameTag name={a.ensName} state="minted" href={basescan(a.ensName)} />
                  )}
                  <div className="text-[12px] font-semibold text-muted">
                    {a.buildsCount.toLocaleString()} jams built
                  </div>
                </div>
                <span
                  className={`ml-auto self-start border-2 border-ink rounded-full px-3 py-1 text-[13px] font-extrabold ${
                    free ? "bg-green text-ink" : "bg-pink text-white"
                  }`}
                >
                  {free ? "Free" : `${a.priceUsdc} USDC`}
                </span>
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
