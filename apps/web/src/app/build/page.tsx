"use client";

// Make — idea → jam (DESIGN_BRIEF §3c). A sequence of beats, never a labelled
// wizard: idea → follow-ups → plan → choose builder → (World gate, once) →
// workshop → reveal. Machinery hidden throughout: no build logs, file names,
// terminals, or "AI/agent" talk anywhere a user can see.
import type { AppSpec, BuildId, RefineResult, Similar } from "@superjam/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useConfirm } from "../../components/confirm/confirm-provider";
import { jamEns } from "../../components/ui/brand";
import { cx } from "../../components/ui/cx";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
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
  const { hostUser } = useHostAuth();
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
        if (res.type === "questions") {
          setQuestions(res.questions);
          setStep("followups");
        } else {
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
      if (res.type === "spec") setSpec(res.spec);
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
    <div className="flex flex-col gap-4 px-5 pt-14 pb-6 bg-cream min-h-full">
      <Header username={username} />

      {step === "home" && (
        <HomeBeat
          idea={idea}
          setIdea={setIdea}
          remix={remixSlug}
          busy={busy}
          err={err}
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
        <BuilderBeat builders={builders} onPick={pickBuilder} />
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
      <div className="font-extrabold text-lg">superjam</div>
      <a
        href="/me"
        className="ml-auto bg-card border-2 border-ink rounded-full px-3.5 py-1.5 text-[13px] font-semibold no-underline text-ink"
      >
        @{username} ▾
      </a>
    </div>
  );
}

function HomeBeat({
  idea,
  setIdea,
  remix,
  busy,
  err,
  onGo,
}: {
  idea: string;
  setIdea: (v: string) => void;
  remix: string | null;
  busy: boolean;
  err: string | null;
  onGo: () => void;
}) {
  return (
    <>
      {remix && (
        <div className="bg-yellow border-2 border-ink rounded-toy px-3 py-2 text-[13px] font-bold">
          🔁 Based on <span className="underline">{remix}</span> — say your changes
        </div>
      )}
      <div className="flex flex-col gap-1 mt-1">
        <div className="text-[28px] font-extrabold leading-tight">
          {remix ? "Your changes" : "Dream up"}
          {!remix && (
            <>
              <br />a little app! <span className="inline-block rotate-[8deg]">🧸</span>
            </>
          )}
        </div>
        <div className="text-[14.5px] font-medium text-muted">
          Say it in a sentence — we'll make it real.
        </div>
      </div>
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        rows={3}
        placeholder="what should it do?"
        className="bg-card border-2 border-ink rounded-toy p-4 text-[15px] font-medium leading-relaxed placeholder:text-muted outline-none focus:border-pink shadow-sticker resize-none"
      />
      {err && <div className="text-pink text-[13px] font-bold">{err}</div>}
      <StickerButton color="pink" size="lg" block onClick={onGo} disabled={busy || !idea.trim()}>
        {busy ? "thinking…" : "Let's go! →"}
      </StickerButton>

      <div className="flex flex-wrap gap-2 mt-1">
        {["a tip jar with a leaderboard", "a daily trivia game", "a doodle guessing duel"].map(
          (ex) => (
            <button
              key={ex}
              onClick={() => setIdea(ex)}
              className="bg-cream border-2 border-ink rounded-full px-3 py-1.5 text-xs font-semibold text-muted sticker-press"
            >
              {ex}
            </button>
          )
        )}
      </div>
    </>
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
        <div className="bg-card border-2 border-ink rounded-2xl rounded-tl-sm px-3.5 py-3 text-sm font-semibold shadow-sticker">
          Ooh, fun! Two quick things before I draw up the plan:
        </div>
      </div>

      {similar.length > 0 && (
        <StickerCard color="cream" className="p-3 flex flex-col gap-2">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
            similar jams already exist
          </div>
          {similar.slice(0, 3).map((s) => (
            <button
              key={s.slug}
              onClick={() => onOpenSimilar(s)}
              className="flex items-center gap-2 text-left text-[13px] font-semibold"
            >
              <span>🧩</span>
              <span className="font-bold">{s.slug}</span>
              <span className="text-muted">— {s.reason}</span>
              <span className="ml-auto text-blue text-xs font-extrabold">Open ›</span>
            </button>
          ))}
        </StickerCard>
      )}

      <div className="flex flex-col gap-3.5 pl-9">
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="text-[15px] font-semibold">{q.q}</div>
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => (
                <button
                  key={o}
                  onClick={() => setPick(i, o)}
                  className={cx(
                    "border-2 border-ink rounded-full px-4 py-2 text-sm sticker-press",
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
        <div className="text-[12px] font-extrabold uppercase tracking-wide text-muted">
          your comments
        </div>
        {comments.map((c, i) => (
          <div
            key={i}
            className="flex items-center gap-2 bg-card border-2 border-ink rounded-xl px-3 py-2 text-[13px] font-semibold"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-pink border-[1.5px] border-ink shrink-0" />
            <span className="min-w-0 break-words">{c}</span>
            <button onClick={() => removeComment(i)} className="ml-auto text-muted font-bold">
              ✕
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                addComment(draft.trim());
                setDraft("");
              }
            }}
            placeholder="add a line…"
            className="flex-1 bg-card border-2 border-ink rounded-full px-4 py-2.5 text-[13.5px] font-semibold placeholder:text-muted outline-none focus:border-pink"
          />
          <button
            onClick={() => {
              if (draft.trim()) {
                addComment(draft.trim());
                setDraft("");
              }
            }}
            className="w-12 h-12 bg-card border-2 border-ink rounded-full text-xl font-extrabold sticker-press"
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
        <div className="text-[26px] font-extrabold leading-tight">Here's the plan!</div>
        <div className="text-sm font-medium text-muted">
          tweak anything — the plan keeps up
        </div>
      </div>

      <StickerCard className="p-4 flex flex-col gap-3 shadow-sticker-lg" tilt={-0.6}>
        <div className="flex items-center gap-3">
          <EmojiToken emoji={spec.iconEmoji} color="yellow" size={56} rounded="toy" tilt={-5} />
          <div className="flex flex-col min-w-0">
            <div className="font-extrabold text-xl truncate">{spec.name}</div>
            <div className="text-[13px] font-medium text-muted leading-snug">
              {spec.description}
            </div>
          </div>
        </div>

        {/* ENS address row */}
        <div className="flex items-center gap-1.5 bg-cream border-2 border-ink rounded-l-md rounded-r-full pl-2.5 pr-2.5 py-1.5">
          <span className="w-[7px] h-[7px] rounded-full bg-yellow border-[1.5px] border-ink shrink-0" />
          <span className="font-mono text-[12px] font-bold truncate">
            {spec.slug}
            <span className="text-muted font-medium">.{username}.superjam.fun</span>
          </span>
          <span className="ml-auto flex items-center gap-1 bg-green border-[1.5px] border-ink rounded-full px-2 py-0.5 text-[10.5px] font-extrabold">
            ✓ free
          </span>
        </div>

        <div className="h-0.5 bg-ink/10 rounded" />

        <div className="flex flex-col gap-2.5">
          <div className="text-[12px] font-extrabold uppercase tracking-wide text-muted">
            What's inside
          </div>
          {spec.features.slice(0, 5).map((f, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm font-semibold">
              <span className="w-6 h-6 rounded-lg bg-cream border-2 border-ink flex items-center justify-center text-xs shrink-0">
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
          <div className="self-end max-w-[78%] bg-pink text-white border-2 border-ink rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] font-semibold shadow-sticker-sm">
            {e.you}
          </div>
          {e.back && (
            <div className="flex items-end gap-2">
              <EmojiToken emoji="⚡" color="yellow" size={26} tilt={-6} />
              <div className="bg-card border-2 border-ink rounded-2xl rounded-bl-sm px-3.5 py-2 text-[13px] font-semibold shadow-sticker-sm">
                {e.back}
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim() && !busy) {
              onAdjust(draft.trim());
              setDraft("");
            }
          }}
          placeholder="✏️ change anything — just say it"
          className="flex-1 bg-card border-2 border-ink rounded-full px-4 py-3 text-[13.5px] font-semibold placeholder:text-muted outline-none focus:border-pink"
        />
        <button
          onClick={() => {
            if (draft.trim() && !busy) {
              onAdjust(draft.trim());
              setDraft("");
            }
          }}
          className="w-12 h-12 bg-yellow border-2 border-ink rounded-full text-lg font-extrabold sticker-press"
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
}: {
  builders: Builder[];
  onPick: (b: Builder) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="text-[26px] font-extrabold leading-tight">Who makes it?</div>
        <div className="text-sm font-medium text-muted">
          the house builder's free — or pick a pro
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {builders.map((b) => {
          const free = Number(b.priceUsdc) === 0;
          return (
            <StickerCard key={b.id} className="p-4 flex items-center gap-3">
              <EmojiToken emoji={free ? "🏠" : "🛠️"} color={free ? "green" : "blue"} size={48} rounded="toy" />
              <div className="flex flex-col min-w-0">
                <div className="font-extrabold text-[15.5px] truncate">{b.name}</div>
                <div className="text-[12px] font-semibold text-muted">
                  ★ 4.9 · {b.buildsCount.toLocaleString()} jams built
                </div>
              </div>
              <button
                onClick={() => onPick(b)}
                className={cx(
                  "ml-auto border-2 border-ink rounded-full px-4 py-2 text-sm font-extrabold shadow-sticker-sm sticker-press",
                  free ? "bg-green text-ink" : "bg-pink text-white"
                )}
              >
                {free ? "Free" : `${b.priceUsdc} USDC`}
              </button>
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
        <div className="text-xl font-extrabold">couldn't finish this jam</div>
        <div className="text-sm font-semibold text-muted max-w-[260px]">
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
      <div className="text-xl font-extrabold">Making your jam…</div>
      <div className="font-mono text-[12px] text-muted">
        {spec.slug}.{username}.superjam.fun
      </div>
      <div className="w-full flex flex-col gap-2.5 mt-1">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cx(
              "flex items-center gap-2.5 text-sm font-bold",
              i < done ? "text-ink" : i === done ? "text-ink" : "text-muted opacity-50"
            )}
          >
            <span
              className={cx(
                "w-5 h-5 rounded-full border-2 border-ink flex items-center justify-center text-[10px]",
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
  const ens = jamEns(slug, username);
  const link = `superjam.fun/${username}/${slug}`;
  const copy = () => navigator.clipboard?.writeText(`https://${link}`).catch(() => {});
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="text-4xl">🎉</div>
      <EmojiToken emoji={spec.iconEmoji} color="yellow" size={96} rounded="toy" tilt={-5} className="shadow-sticker-lg" />
      <div className="text-2xl font-extrabold">{spec.name} is live!</div>
      <div className="inline-flex items-center gap-1.5 bg-card border-2 border-ink rounded-l-md rounded-r-full pl-2.5 pr-3 py-1.5">
        <span className="w-[7px] h-[7px] rounded-full bg-yellow border-[1.5px] border-ink" />
        <span className="font-mono text-[12px] font-bold">
          {slug}
          <span className="text-muted font-medium">.{username}.superjam.fun</span>
        </span>
        <span className="text-[10px] font-extrabold text-green-ink">✓</span>
      </div>
      <button
        onClick={copy}
        className="text-[12.5px] font-mono font-semibold text-muted underline"
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
