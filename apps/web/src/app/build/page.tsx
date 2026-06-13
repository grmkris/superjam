"use client";

// Make — idea → jam (DESIGN_BRIEF §3c). A sequence of beats, never a labelled
// wizard: idea → follow-ups → plan → choose builder → (World gate, once) →
// workshop → reveal. Machinery hidden throughout: no build logs, file names,
// terminals, or "AI/agent" talk anywhere a user can see.
import type { AppSpec, BuildId, RefineResult, Similar } from "@superjam/shared";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useConfirm } from "../../components/confirm/confirm-provider";
import { jamEns } from "../../components/ui/brand";
import { cx } from "../../components/ui/cx";
import { Badge } from "../../components/ui/badge";
import { Input, Textarea } from "../../components/ui/field";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { VerifiedBadge } from "../../components/verified-badge";
import { usePlatformClient } from "../../components/use-platform-client";
import { WorldGate } from "../../components/world-gate";
import { useHostAuth } from "../../lib/use-host-auth";

type Step = "home" | "followups" | "plan" | "builder" | "worldgate" | "workshop" | "reveal";

interface Builder {
  id: string;
  name: string;
  ensName: string | null;
  priceUsdc: string;
  buildsCount: number;
  /** The human backer (community builders). Absent for the house builder. */
  owner?: { username: string; worldVerified: boolean };
}

const HOUSE: Builder = {
  id: "house",
  name: "House Builder",
  ensName: null,
  priceUsdc: "0",
  buildsCount: 4200,
};

export default function MakePage() {
  return (
    <Suspense fallback={null}>
      <MakeFlow />
    </Suspense>
  );
}

function MakeFlow() {
  const router = useRouter();
  const search = useSearchParams();
  const remixSlug = search.get("remix");
  const client = usePlatformClient();
  const { confirm } = useConfirm();
  const { hostUser, isLoggedIn } = useHostAuth();
  const { setShowAuthFlow } = useDynamicContext();
  const username = hostUser?.username ?? "you";

  const [step, setStep] = useState<Step>("home");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [questions, setQuestions] = useState<{ q: string; options: string[] }[]>([]);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [comments, setComments] = useState<string[]>([]);
  const [spec, setSpec] = useState<AppSpec | null>(null);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [builders, setBuilders] = useState<Builder[]>([HOUSE]);
  const [exchange, setExchange] = useState<{ you: string; back: string }[]>([]);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [revealSlug, setRevealSlug] = useState<string | null>(null);

  const handleRefine = useCallback(
    async (answers?: { q: string; a: string }[]) => {
      setBusy(true);
      setErr(null);
      try {
        const res: RefineResult = await client.builds.refine({
          prompt: idea,
          answers,
        });
        setSimilar(res.similar ?? []);
        if (res.type === "questions" && res.questions) {
          setQuestions(res.questions);
          setStep("followups");
        } else if (res.spec) {
          setSpec(res.spec);
          setStep("plan");
        }
      } catch {
        // Refiner unavailable — keep the user moving with a friendly fallback.
        setErr("the workshop's a bit busy — try that once more");
      } finally {
        setBusy(false);
      }
    },
    [client, idea]
  );

  const drawPlan = () => {
    const answers = [
      ...questions.map((q, i) => ({ q: q.q, a: picks[i] ?? "either's fine" })),
      ...comments.map((c) => ({ q: "note", a: c })),
    ];
    handleRefine(answers);
  };

  const adjust = async (text: string) => {
    setExchange((x) => [...x, { you: text, back: "" }]);
    setBusy(true);
    try {
      const res = await client.builds.refine({
        prompt: idea,
        answers: [{ q: "change", a: text }],
      });
      if (res.type === "spec" && res.spec) setSpec(res.spec);
      setExchange((x) =>
        x.map((e, i) => (i === x.length - 1 ? { ...e, back: "Done — updated ☝️" } : e))
      );
    } catch {
      setExchange((x) =>
        x.map((e, i) => (i === x.length - 1 ? { ...e, back: "hmm, try saying it another way" } : e))
      );
    } finally {
      setBusy(false);
    }
  };

  const goBuilders = async () => {
    setStep("builder");
    try {
      const rows = await client.agents.list();
      setBuilders([
        HOUSE,
        ...rows.map((a) => ({
          id: a.id,
          name: a.name,
          ensName: a.ensName,
          priceUsdc: a.priceUsdc,
          buildsCount: a.buildsCount,
          owner: a.owner,
        })),
      ]);
    } catch {
      /* house builder is always available */
    }
  };

  const pickBuilder = async (b: Builder) => {
    const price = Number(b.priceUsdc);
    if (price > 0) {
      // Paid builders route USDC via the confirm sheet BEFORE dispatch
      // (build fee = attempt fee, no refunds).
      const res = await confirm({
        kind: "tip",
        to: b.ensName ?? b.id,
        toName: b.ensName ?? undefined,
        amountUsdc: price,
        memo: "build fee — no refunds",
        jam: spec ? { name: spec.name, iconEmoji: spec.iconEmoji } : undefined,
      }).catch(() => ({ approved: false }));
      if (!res.approved) return;
    }
    if (!hostUser?.worldVerified) setStep("worldgate");
    else startBuild();
  };

  const startBuild = async () => {
    setStep("workshop");
    try {
      // Fire the real build; the workshop then polls builds.status for progress.
      const res = await client.builds.create({ spec: spec!, prompt: idea });
      setBuildId(res.buildId);
    } catch {
      // The free build may be spent / sign-in needed — the workshop falls back
      // to its animation and the reveal opens the spec slug.
    }
  };

  return (
    <div className="screen">
      <Header username={username} />

      {step === "home" && (
        <HomeBeat
          idea={idea}
          setIdea={setIdea}
          remix={remixSlug}
          busy={busy}
          err={err}
          isLoggedIn={isLoggedIn}
          onLogin={() => setShowAuthFlow(true)}
          onGo={() => idea.trim() && handleRefine()}
        />
      )}

      {step === "followups" && (
        <FollowupsBeat
          questions={questions}
          picks={picks}
          setPick={(i, o) => setPicks((p) => ({ ...p, [i]: o }))}
          comments={comments}
          addComment={(c) => setComments((cs) => [...cs, c])}
          removeComment={(i) => setComments((cs) => cs.filter((_, j) => j !== i))}
          similar={similar}
          busy={busy}
          onDraw={drawPlan}
          onOpenSimilar={(s) => router.push(`/j/${s.slug}`)}
        />
      )}

      {step === "plan" && spec && (
        <PlanBeat
          spec={spec}
          username={username}
          exchange={exchange}
          busy={busy}
          onAdjust={adjust}
          onMake={goBuilders}
        />
      )}

      {step === "builder" && (
        <BuilderBeat
          builders={builders}
          onPick={pickBuilder}
          onInfo={(id) => router.push(`/agents/${id}`)}
        />
      )}

      {step === "worldgate" && <WorldGate onVerified={startBuild} />}

      {step === "workshop" && spec && (
        <WorkshopBeat
          spec={spec}
          username={username}
          buildId={buildId}
          onDone={(slug) => {
            setRevealSlug(slug);
            setStep("reveal");
          }}
        />
      )}

      {step === "reveal" && spec && (
        <RevealBeat
          spec={spec}
          username={username}
          slug={revealSlug ?? spec.slug}
          onPlay={() => router.push(`/app/${revealSlug ?? spec.slug}`)}
        />
      )}
    </div>
  );
}

function Header({ username }: { username: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <EmojiToken emoji="⚡" color="yellow" size={32} tilt={-6} />
      <div className="font-extrabold text-h3">superjam</div>
      <Link
        href="/me"
        className="focus-ring ml-auto bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-small font-semibold no-underline text-ink"
      >
        @{username} ▾
      </Link>
    </div>
  );
}

function HomeBeat({
  idea,
  setIdea,
  remix,
  busy,
  err,
  isLoggedIn,
  onLogin,
  onGo,
}: {
  idea: string;
  setIdea: (v: string) => void;
  remix: string | null;
  busy: boolean;
  err: string | null;
  isLoggedIn: boolean;
  onLogin: () => void;
  onGo: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4">
      {remix && (
        <div className="bg-yellow border-2 border-ink rounded-toy px-3 py-2 text-small font-bold">
          🔁 Based on <span className="underline">{remix}</span> — say your changes
        </div>
      )}
      <div className="flex flex-col gap-1 mt-1">
        <div className="text-h1 font-extrabold">
          {remix ? "Your changes" : "Dream up"}
          {!remix && (
            <>
              <br />a little app! <span className="inline-block rotate-[8deg]">🧸</span>
            </>
          )}
        </div>
        <div className="text-body font-medium text-muted">
          Say it in a sentence — we'll make it real.
        </div>
      </div>
      <Textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        rows={3}
        placeholder="what should it do?"
        className="leading-relaxed shadow-sticker"
      />
      {err && <div className="text-pink text-small font-bold">{err}</div>}
      {isLoggedIn ? (
        <StickerButton color="pink" size="lg" block onClick={onGo} disabled={busy || !idea.trim()}>
          {busy ? "thinking…" : "Let's go! →"}
        </StickerButton>
      ) : (
        // refine is a protected call — a signed-out maker would just 401. Send
        // them through sign-in first; their idea text stays in the box.
        <StickerButton color="pink" size="lg" block onClick={onLogin}>
          Sign in to make →
        </StickerButton>
      )}

      <div className="flex flex-wrap gap-2 mt-1">
        {["a tip jar with a leaderboard", "a daily trivia game", "a doodle guessing duel"].map(
          (ex) => (
            <button
              key={ex}
              onClick={() => setIdea(ex)}
              className="focus-ring bg-cream border-2 border-ink rounded-full px-3 py-1.5 text-small font-semibold text-muted sticker-press"
            >
              {ex}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function FollowupsBeat({
  questions,
  picks,
  setPick,
  comments,
  addComment,
  removeComment,
  similar,
  busy,
  onDraw,
  onOpenSimilar,
}: {
  questions: { q: string; options: string[] }[];
  picks: Record<number, string>;
  setPick: (i: number, o: string) => void;
  comments: string[];
  addComment: (c: string) => void;
  removeComment: (i: number) => void;
  similar: Similar[];
  busy: boolean;
  onDraw: () => void;
  onOpenSimilar: (s: Similar) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <>
      <div className="flex items-start gap-2">
        <EmojiToken emoji="⚡" color="yellow" size={30} tilt={-6} />
        <div className="bg-card border-2 border-ink rounded-2xl rounded-tl-sm px-3.5 py-3 text-small font-semibold shadow-sticker">
          Ooh, fun! Two quick things before I draw up the plan:
        </div>
      </div>

      {similar.length > 0 && (
        <StickerCard color="cream" className="p-3 flex flex-col gap-2">
          <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            similar jams already exist
          </div>
          {similar.slice(0, 3).map((s) => (
            <button
              key={s.slug}
              onClick={() => onOpenSimilar(s)}
              className="focus-ring flex items-center gap-2 text-left text-small font-semibold"
            >
              <span>🧩</span>
              <span className="font-bold">{s.slug}</span>
              <span className="text-muted">— {s.reason}</span>
              <span className="ml-auto text-blue text-tiny font-extrabold">Open ›</span>
            </button>
          ))}
        </StickerCard>
      )}

      <div className="flex flex-col gap-3 pl-9">
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="text-body font-semibold">{q.q}</div>
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => (
                <button
                  key={o}
                  onClick={() => setPick(i, o)}
                  className={cx(
                    "focus-ring border-2 border-ink rounded-full px-4 py-2 text-small sticker-press",
                    picks[i] === o
                      ? "bg-yellow font-bold shadow-sticker-sm"
                      : "bg-card font-semibold"
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 mt-1">
        <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
          your comments
        </div>
        {comments.map((c, i) => (
          <div
            key={i}
            className="flex items-center gap-2 bg-card border-2 border-ink rounded-xl px-3 py-2 text-small font-semibold"
          >
            <span className="size-1.5 rounded-full bg-pink border-[1.5px] border-ink shrink-0" />
            <span className="min-w-0 break-words">{c}</span>
            <button onClick={() => removeComment(i)} className="focus-ring ml-auto text-muted font-bold" aria-label="Remove comment">
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                addComment(draft.trim());
                setDraft("");
              }
            }}
            placeholder="add a line…"
            className="flex-1 rounded-full text-small"
          />
          <button
            onClick={() => {
              if (draft.trim()) {
                addComment(draft.trim());
                setDraft("");
              }
            }}
            className="focus-ring size-12 shrink-0 bg-card border-2 border-ink rounded-full text-xl font-extrabold sticker-press"
            aria-label="Add comment"
          >
            +
          </button>
        </div>
      </div>

      <StickerButton color="green" size="lg" block onClick={onDraw} disabled={busy}>
        {busy ? "drawing it up…" : "Draw up the plan →"}
      </StickerButton>
    </>
  );
}

function PlanBeat({
  spec,
  username,
  exchange,
  busy,
  onAdjust,
  onMake,
}: {
  spec: AppSpec;
  username: string;
  exchange: { you: string; back: string }[];
  busy: boolean;
  onAdjust: (t: string) => void;
  onMake: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="text-h2 font-extrabold">Here's the plan!</div>
        <div className="text-small font-medium text-muted">
          tweak anything — the plan keeps up
        </div>
      </div>

      <StickerCard className="p-4 flex flex-col gap-3 shadow-sticker-lg" tilt={-0.6}>
        <div className="flex items-center gap-3">
          <EmojiToken emoji={spec.iconEmoji} color="yellow" size={56} rounded="toy" tilt={-5} />
          <div className="flex flex-col min-w-0">
            <div className="font-extrabold text-h3 truncate">{spec.name}</div>
            <div className="text-small font-medium text-muted leading-snug">
              {spec.description}
            </div>
          </div>
        </div>

        {/* ENS address row */}
        <div className="flex items-center gap-1.5 bg-cream border-2 border-ink rounded-l-md rounded-r-full pl-2.5 pr-2.5 py-1.5">
          <span className="size-[7px] rounded-full bg-yellow border-[1.5px] border-ink shrink-0" />
          <span className="font-mono text-small font-bold truncate">
            {spec.slug}
            <span className="text-muted font-medium">.{username}.superjam.fun</span>
          </span>
          <Badge color="green" className="ml-auto border-[1.5px] px-2">✓ free</Badge>
        </div>

        <div className="h-0.5 bg-ink/10 rounded" />

        <div className="flex flex-col gap-2.5">
          <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            What's inside
          </div>
          {spec.features.slice(0, 5).map((f, i) => (
            <div key={i} className="flex items-center gap-2.5 text-small font-semibold">
              <span className="size-6 rounded-lg bg-cream border-2 border-ink flex items-center justify-center text-tiny shrink-0">
                {["🪙", "💬", "🏆", "🔔", "✨"][i % 5]}
              </span>
              <span className="min-w-0">{f}</span>
            </div>
          ))}
        </div>
      </StickerCard>

      {/* refine exchange */}
      {exchange.map((e, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="self-end max-w-[78%] bg-pink text-white border-2 border-ink rounded-2xl rounded-br-sm px-3.5 py-2 text-small font-semibold shadow-sticker-sm">
            {e.you}
          </div>
          {e.back && (
            <div className="flex items-end gap-2">
              <EmojiToken emoji="⚡" color="yellow" size={26} tilt={-6} />
              <div className="bg-card border-2 border-ink rounded-2xl rounded-bl-sm px-3.5 py-2 text-small font-semibold shadow-sticker-sm">
                {e.back}
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim() && !busy) {
              onAdjust(draft.trim());
              setDraft("");
            }
          }}
          placeholder="✏️ change anything — just say it"
          className="flex-1 rounded-full text-small"
        />
        <button
          onClick={() => {
            if (draft.trim() && !busy) {
              onAdjust(draft.trim());
              setDraft("");
            }
          }}
          className="focus-ring size-12 shrink-0 bg-yellow border-2 border-ink rounded-full text-lg font-extrabold sticker-press"
          aria-label="Send change"
        >
          ↑
        </button>
      </div>

      <StickerButton color="green" size="lg" block onClick={onMake}>
        Make it! 🔨
      </StickerButton>
    </>
  );
}

function BuilderBeat({
  builders,
  onPick,
  onInfo,
}: {
  builders: Builder[];
  onPick: (b: Builder) => void;
  onInfo: (id: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="text-h2 font-extrabold">Who makes it?</div>
        <div className="text-small font-medium text-muted">
          the house builder's free — or pick a human-backed pro
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {builders.map((b) => {
          const free = Number(b.priceUsdc) === 0;
          return (
            <StickerCard key={b.id} className="p-4 flex items-center gap-3">
              <EmojiToken emoji={free ? "🏠" : "🛠️"} color={free ? "green" : "blue"} size={48} rounded="toy" />
              <div className="flex flex-col min-w-0 gap-0.5">
                <div className="font-extrabold text-body truncate">{b.name}</div>
                {b.owner ? (
                  <span className="inline-flex items-center gap-1.5 text-small font-semibold text-muted">
                    by @{b.owner.username}
                    {b.owner.worldVerified && <VerifiedBadge />}
                  </span>
                ) : (
                  <span className="text-small font-semibold text-muted">the house builder</span>
                )}
                <div className="text-small font-semibold text-muted">
                  {b.buildsCount.toLocaleString()} jams built
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {b.owner && (
                  <button
                    onClick={() => onInfo(b.id)}
                    aria-label="builder profile"
                    className="focus-ring text-blue font-extrabold text-h3 px-1"
                  >
                    ⓘ
                  </button>
                )}
                <button
                  onClick={() => onPick(b)}
                  className={cx(
                    "focus-ring border-2 border-ink rounded-full px-4 py-2 text-small font-extrabold shadow-sticker-sm sticker-press",
                    free ? "bg-green text-ink" : "bg-pink text-white"
                  )}
                >
                  {free ? "Free" : `${b.priceUsdc} USDC`}
                </button>
              </div>
            </StickerCard>
          );
        })}
      </div>
    </>
  );
}

const STEPS = [
  "Shaping the jar",
  "Fitting the coin slot",
  "Hanging the name tag",
  "Adding the leaderboard",
];

function WorkshopBeat({
  spec,
  username,
  buildId,
  onDone,
}: {
  spec: AppSpec;
  username: string;
  buildId: string | null;
  onDone: (slug: string) => void;
}) {
  const client = usePlatformClient();
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  // Visual step animation — caps at the last step until the REAL build finishes.
  useEffect(() => {
    if (done >= STEPS.length - 1) return;
    const t = setTimeout(() => setDone((d) => Math.min(d + 1, STEPS.length - 1)), 1100);
    return () => clearTimeout(t);
  }, [done]);

  // Poll the real build; completion + the reveal slug come from the server.
  useEffect(() => {
    if (!buildId) {
      // create() didn't land (free build spent / signed out) — finish as a demo.
      const t = setTimeout(() => {
        setDone(STEPS.length);
        onDone(spec.slug);
      }, STEPS.length * 1100 + 700);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await client.builds.status({ buildId: buildId as BuildId });
        if (cancelled) return;
        if (s.status === "failed") {
          setFailed(s.error ?? "couldn't finish this jam");
          return;
        }
        if (
          s.status === "done" &&
          (s.appStatus === "listed" || s.appStatus === "deployed")
        ) {
          setDone(STEPS.length);
          onDone(s.slug ?? spec.slug);
          return;
        }
      } catch {
        /* transient — keep polling */
      }
      timer = setTimeout(poll, 1300);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [buildId, client, onDone, spec.slug]);

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <EmojiToken emoji="😖" color="pink" size={72} rounded="toy" />
        <div className="text-h3 font-extrabold">couldn't finish this jam</div>
        <div className="text-small font-semibold text-muted max-w-[260px]">
          the workshop hit a snag — give it another go.
        </div>
        <StickerButton color="pink" size="lg" onClick={() => location.assign("/build")}>
          Try again
        </StickerButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <EmojiToken emoji={spec.iconEmoji} color="yellow" size={84} rounded="toy" tilt={-5} className="shadow-sticker-lg" />
      <div className="text-h3 font-extrabold">Making your jam…</div>
      <div className="font-mono text-small text-muted">
        {spec.slug}.{username}.superjam.fun
      </div>
      <div className="w-full flex flex-col gap-2.5 mt-1">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cx(
              "flex items-center gap-2.5 text-small font-bold",
              i < done ? "text-ink" : i === done ? "text-ink" : "text-muted opacity-50"
            )}
          >
            <span
              className={cx(
                "size-5 rounded-full border-2 border-ink flex items-center justify-center text-tiny",
                i < done ? "bg-green" : "bg-card"
              )}
            >
              {i < done ? "✓" : i === done ? "…" : ""}
            </span>
            {s}
            {i === done && i === 2 && <span className="text-muted">⛓</span>}
          </div>
        ))}
      </div>
      <div className="w-full h-3 rounded-full bg-card border-2 border-ink overflow-hidden mt-1">
        <div
          className="h-full bg-pink transition-all duration-700"
          style={{ width: `${(done / STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function RevealBeat({
  spec,
  username,
  slug,
  onPlay,
}: {
  spec: AppSpec;
  username: string;
  slug: string;
  onPlay: () => void;
}) {
  const ens = jamEns(slug);
  const link = `superjam.fun/${username}/${slug}`;
  const copy = () => navigator.clipboard?.writeText(`https://${link}`).catch(() => {});
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="text-4xl">🎉</div>
      <EmojiToken emoji={spec.iconEmoji} color="yellow" size={96} rounded="toy" tilt={-5} className="shadow-sticker-lg" />
      <div className="text-h2 font-extrabold">{spec.name} is live!</div>
      <div className="inline-flex items-center gap-1.5 bg-card border-2 border-ink rounded-l-md rounded-r-full pl-2.5 pr-3 py-1.5">
        <span className="size-[7px] rounded-full bg-yellow border-[1.5px] border-ink" />
        <span className="font-mono text-small font-bold">
          {slug}
          <span className="text-muted font-medium">.{username}.superjam.fun</span>
        </span>
        <span className="text-tiny font-extrabold text-green-ink">✓</span>
      </div>
      <button
        onClick={copy}
        className="focus-ring text-small font-mono font-semibold text-muted underline"
        title="copy deep link"
      >
        {link} 📋
      </button>
      <div className="flex gap-3 w-full mt-1">
        <StickerButton color="white" size="lg" block onClick={copy}>
          Share
        </StickerButton>
        <StickerButton color="pink" size="lg" block onClick={onPlay}>
          ▸ Play
        </StickerButton>
      </div>
      <span className="sr-only">{ens}</span>
    </div>
  );
}
