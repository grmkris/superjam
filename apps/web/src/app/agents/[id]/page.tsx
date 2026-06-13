"use client";

// Builder profile (DESIGN_BRIEF §3c-v) — a de-jargoned page rendered from the
// builder's record: the human backer leads (@owner ✓), then the agent's ENS
// name, its on-chain ERC-8004 identity, price, and jams built. No "ERC-8004"
// shouting at the top — the standard reads as live, fetched metadata.
import type { BuilderAgentId } from "@superjam/shared";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { NameTag } from "../../../components/name-tag";
import { Handle, VerifiedBadge } from "../../../components/verified-badge";
import { basescan } from "../../../components/ui/brand";
import { EmojiToken, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { usePlatformClient } from "../../../components/use-platform-client";

interface Agent {
  id: string;
  name: string;
  ensName: string | null;
  erc8004Id: string | null;
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
    return <div className="p-6 text-muted font-semibold">loading…</div>;
  }
  if (agent === "missing") {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="text-5xl">🛠️</div>
        <div className="font-extrabold text-lg">builder not found</div>
        <button onClick={() => router.push("/agents")} className="font-bold text-blue">
          ‹ all builders
        </button>
      </div>
    );
  }

  const free = Number(agent.priceUsdc) === 0;
  return (
    <div className="flex flex-col gap-4 px-5 pt-14 pb-6 bg-cream min-h-full">
      <button onClick={() => router.push("/agents")} className="self-start text-[13px] font-bold text-muted">
        ‹ all builders
      </button>

      <div className="flex items-center gap-3">
        <EmojiToken emoji="🛠️" color="blue" size={56} rounded="toy" tilt={-5} />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="font-extrabold text-2xl truncate">{agent.name}</div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            backed by <Handle username={agent.owner.username} verified={agent.owner.worldVerified} />
          </div>
        </div>
      </div>

      {/* the record — fetched, de-jargoned */}
      <StickerCard color="white" className="p-5 flex flex-col gap-3 shadow-sticker-md">
        {agent.ensName && (
          <Row label="name">
            <NameTag name={agent.ensName} state="minted" href={basescan(agent.ensName)} />
          </Row>
        )}
        <Row label="human">
          <VerifiedBadge variant="pill" label={agent.owner.worldVerified ? "real human" : "unverified"} />
        </Row>
        {agent.erc8004Id && (
          <Row label="identity">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold">
              <span className="bg-green border-[1.5px] border-ink rounded-full w-[15px] h-[15px] inline-flex items-center justify-center text-[8.5px]">
                ✓
              </span>
              registered on-chain · #{agent.erc8004Id}
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
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted w-[84px] shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}
