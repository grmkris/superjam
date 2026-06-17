"use client";

// Builder profile (DESIGN_BRIEF §3c-v) — a de-jargoned page rendered from the
// builder's record: the maker leads (@owner), then what it can build, the
// builder's rate, and jams built. Builds are FREE to users right now — the USDC
// figure is the builder's listed rate, not a charge.
import type { BuilderAgentId } from "@superjam/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { HandleLink } from "../../../components/handle-link";
import { capLabels, modelLabel } from "../../../components/ui/brand";
import { MakerLine } from "../../../components/builder-bits";
import { EmojiToken, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { EmptyState } from "../../../components/ui/empty-state";
import { Skeleton } from "../../../components/ui/skeleton";
import { usePlatformClient } from "../../../components/use-platform-client";

interface Agent {
  id: string;
  name: string;
  ownerUserId: string;
  model: string | null;
  priceUsdc: string;
  buildsCount: number;
  walletAddress: string;
  capabilities: string[];
  owner: { username: string };
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
            <StickerButton color="white" size="sm" onClick={() => router.push(backTo)}>
              {backLabel}
            </StickerButton>
          }
        />
      </div>
    );
  }

  const free = Number(agent.priceUsdc) === 0;
  return (
    <div className="screen">
      <button onClick={() => router.push(backTo)} className="focus-ring self-start text-small font-bold text-muted">
        {backLabel}
      </button>

      <div className="flex items-center gap-3">
        <EmojiToken emoji="🛠️" color="blue" size={56} rounded="toy" tilt={-5} />
        <div className="flex flex-col gap-1 min-w-0">
          <div className="font-extrabold text-h2 truncate">{agent.name}</div>
          <MakerLine username={agent.owner.username} />
        </div>
      </div>

      {/* the record — fetched, de-jargoned */}
      <StickerCard color="white" className="p-5 flex flex-col gap-3 shadow-sticker-md">
        <Row label="maker">
          <span className="inline-flex flex-wrap items-center gap-2 text-small font-semibold">
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
        <Row label="jams built">
          <span className="font-extrabold">{agent.buildsCount.toLocaleString()}</span>
        </Row>
        <Row label="rate">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-extrabold">
              {free ? "Free" : `${agent.priceUsdc} USDC / jam`}
            </span>
            {!free && (
              <span className="bg-green border-2 border-ink rounded-full px-2.5 py-0.5 text-tiny font-extrabold">
                free to build right now
              </span>
            )}
          </span>
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
