"use client";

// Make — idea → jam (DESIGN_BRIEF §3c). A sequence of beats, never a labelled
// wizard: idea → follow-ups → plan → choose builder → (World gate, once) →
// workshop → reveal. Machinery hidden throughout: no build logs, file names,
// terminals, or "AI/agent" talk anywhere a user can see.
import type { AppSpec, BuildDraftId, BuildId, BuilderAgentId, RefineResult, Similar } from "@superjam/shared";
import { ATTACH_MAX_MB, BUILD_ATTACH_MAX, DEMO_MODE } from "@superjam/shared";
import { useLogin } from "../../components/login";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/confirm/confirm-provider";
import { jamEns } from "../../components/ui/brand";
import { cx } from "../../components/ui/cx";
import { Badge } from "../../components/ui/badge";
import { Input, Textarea } from "../../components/ui/field";
import { MicButton } from "../../components/ui/mic-button";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { ToyboxSheet } from "../../components/ui/sheet";
import {
  CapChips,
  MakerLine,
  TierChip,
  TrustRow,
  builderEmoji,
} from "../../components/builder-bits";
import { usePlatformClient } from "../../components/use-platform-client";
import { WorldGate } from "../../components/world-gate";
import { useHostAuth } from "../../lib/use-host-auth";
import { useBuildDraft } from "../../lib/use-build-draft";

type Step = "home" | "followups" | "plan" | "builder" | "worldgate" | "workshop" | "reveal";

/** An uploaded reference attachment (image or doc) for the build prompt. */
interface Attachment {
  key: string;
  name: string;
  mime: string;
}

/** Read a File as a base64 data URL (the upload endpoint strips the prefix). */
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });

interface Builder {
  id: string;
  name: string;
  ensName: string | null;
  model: string | null;
  capabilities: string[];
  stakedUsdc: string | null;
  agentbookRegistered: boolean;
  priceUsdc: string;
  buildsCount: number;
  /** The human backer — every builder is an AI agent backed by a verified human. */
  owner: { username: string; worldVerified: boolean };
}

/** The picked builder + how its fee was settled, carried into builds.create. */
interface Chosen {
  agentId: string;
  payment?: { via: "x402"; token: string };
}

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
  const { hostUser, isLoggedIn, meStatus } = useHostAuth();
  const { openLogin } = useLogin();
  const username = hostUser?.username ?? "you";

  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [questions, setQuestions] = useState<{ q: string; options: string[] }[]>([]);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [comments, setComments] = useState<string[]>([]);
  const [spec, setSpec] = useState<AppSpec | null>(null);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [builders, setBuilders] = useState<Builder[] | null>(null);
  const [exchange, setExchange] = useState<{ you: string; back: string }[]>([]);
  const [buildId, setBuildId] = useState<string | null>(null);
  // The builder the user picked + the build-fee outcome (x402 settlement hash, or
  // null for a free build) — threaded into builds.create so it routes to that
  // builder and skips the legacy EIP-3009 receipt check.
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [revealSlug, setRevealSlug] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // --- resumable draft (URL + localStorage + DB) — survives reload / pay redirect /
  //     World-App round-trip, so the wizard resumes instead of resetting to home. ---
  const { draftId, persist, load } = useBuildDraft({
    initialDraftId: search.get("d"),
    isLoggedIn,
  });
  const [hydrated, setHydrated] = useState(false);

  // The current step is DERIVED from the URL — no state, no URL↔state sync effect
  // (react.dev "You Might Not Need an Effect"). Transitions navigate via go(), which
  // also carries the draft id + remix so a reload/back/forward resumes the right step.
  const step = (search.get("step") as Step | null) ?? "home";
  const go = useCallback(
    (next: Step) => {
      const params = new URLSearchParams();
      if (remixSlug) params.set("remix", remixSlug);
      params.set("d", draftId);
      params.set("step", next);
      router.push(`/build?${params.toString()}`, { scroll: false });
    },
    [remixSlug, draftId, router]
  );

  // ONE mount effect: ensure ?d= is in the URL (resume token) + hydrate the wizard
  // DATA from the persisted draft (localStorage → server). Step is URL-derived, so
  // we never set it here — if the URL has no ?step we jump to the draft's saved step.
  useEffect(() => {
    let cancelled = false;
    load().then((snap) => {
      if (cancelled) return;
      if (snap) {
        setIdea(snap.prompt || "");
        setSpec(snap.spec);
        const s = snap.state ?? {};
        setQuestions(s.questions ?? []);
        setPicks((s.picks ?? {}) as Record<number, string>);
        setComments(s.comments ?? []);
        setExchange(s.exchange ?? []);
        setSimilar(s.similar ?? []);
        setChosen((s.chosen ?? null) as Chosen | null);
        setAttachments((s.attachments ?? []) as Attachment[]);
        setRevealSlug(s.revealSlug ?? null);
        setBuildId(snap.buildId ?? null);
      }
      const urlStep = search.get("step");
      const needD = search.get("d") !== draftId;
      const resumeStep = !urlStep && snap?.step && snap.step !== "home" ? snap.step : null;
      if (needD || resumeStep) {
        const params = new URLSearchParams();
        if (remixSlug) params.set("remix", remixSlug);
        params.set("d", draftId);
        params.set("step", urlStep ?? resumeStep ?? "home");
        router.replace(`/build?${params.toString()}`, { scroll: false });
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save on any meaningful change (after hydration). localStorage is immediate;
  // the DB save is debounced + best-effort inside the hook. (A draft auto-save is a
  // legit "sync state to an external store" — far cleaner than threading persist into
  // every handler.)
  useEffect(() => {
    if (!hydrated) return;
    persist({
      step,
      prompt: idea,
      spec,
      state: { questions, picks, comments, exchange, similar, chosen, attachments, revealSlug },
      buildId,
    });
    // `persist` is included so the login transition (it captures isLoggedIn) re-fires
    // the save → a draft started signed-out is ADOPTED to the account after sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist, hydrated, step, idea, spec, questions, picks, comments, exchange, similar, chosen, attachments, buildId, revealSlug]);

  // Other PENDING drafts (for the "pick up where you left off" banner on home).
  const [otherDrafts, setOtherDrafts] = useState<
    { id: string; step: string; prompt: string; name: string | null; iconEmoji: string | null }[]
  >([]);
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    client.builds
      .listDrafts()
      .then((rows) => {
        if (cancelled) return;
        setOtherDrafts(
          rows
            .filter((r) => r.id !== draftId)
            .map((r) => ({
              id: r.id,
              step: r.step,
              prompt: r.prompt,
              name: r.name,
              iconEmoji: r.iconEmoji,
            }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, client, draftId]);

  // Discard a paused draft from the home list (same mutation as the profile).
  const discardDraft = useCallback(
    (id: string) => {
      setOtherDrafts((d) => d.filter((x) => x.id !== id));
      client.builds.deleteDraft({ draftId: id as BuildDraftId }).catch(() => {});
    },
    [client]
  );

  // Upload reference files (images + CSV/Excel/PDF) for the build prompt: images
  // feed Gemini vision in refine, all are handed to the builder agent as URLs.
  const onAttach = useCallback(
    async (files: FileList) => {
      const room = BUILD_ATTACH_MAX - attachments.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      if (picked.length === 0) return;
      setUploading(true);
      setErr(null);
      try {
        const uploaded = await Promise.all(
          picked.map(async (f) => {
            if (f.size > ATTACH_MAX_MB * 1024 * 1024) {
              throw new Error(`${f.name} is over ${ATTACH_MAX_MB}MB`);
            }
            const res = await client.uploads.create({
              fileName: f.name,
              mimeType: f.type,
              dataBase64: await fileToDataUrl(f),
            });
            return { key: res.key, name: f.name, mime: f.type } satisfies Attachment;
          })
        );
        setAttachments((a) => [...a, ...uploaded]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "couldn't attach that file");
      } finally {
        setUploading(false);
      }
    },
    [client, attachments.length]
  );

  const removeAttachment = useCallback(
    (key: string) => setAttachments((a) => a.filter((x) => x.key !== key)),
    []
  );

  const attachmentKeys = attachments.map((a) => a.key);

  const handleRefine = useCallback(
    async (answers?: { q: string; a: string }[]) => {
      setBusy(true);
      setErr(null);
      try {
        const res: RefineResult = await client.builds.refine({
          prompt: idea,
          answers,
          attachmentKeys: attachments.map((a) => a.key),
        });
        setSimilar(res.similar ?? []);
        if (res.type === "questions" && res.questions) {
          setQuestions(res.questions);
          go("followups");
        } else if (res.spec) {
          setSpec(res.spec);
          go("plan");
        }
      } catch {
        // Refiner unavailable — keep the user moving with a friendly fallback.
        setErr("the workshop's a bit busy — try that once more");
      } finally {
        setBusy(false);
      }
    },
    [client, idea, attachments, go]
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
    go("builder");
    try {
      const rows = await client.agents.list();
      setBuilders(
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
      );
    } catch {
      setBuilders([]);
    }
  };

  const pickBuilder = async (b: Builder) => {
    const price = Number(b.priceUsdc);
    let pick: Chosen = { agentId: b.id };
    if (price > 0) {
      // Paid builders settle the fee via the confirm sheet BEFORE dispatch — over
      // the x402 PRIVATE rail (free for a verified human hiring a human-backed
      // builder). The sheet quotes the builder + offers top-up if short.
      const res = await confirm({
        kind: "buildFee",
        builderId: b.id,
        toName: b.ensName ?? undefined,
        amountUsdc: price,
        jam: spec ? { name: spec.name, iconEmoji: spec.iconEmoji } : undefined,
      }).catch(() => ({ approved: false, txHash: null, paymentToken: undefined }));
      // A successful buildFee always returns a server-signed paymentToken (the
      // receipt builds.create trusts). No token ⇒ treat as not approved.
      if (!res.approved || !res.paymentToken) return;
      pick = { agentId: b.id, payment: { via: "x402", token: res.paymentToken } };
    }
    setChosen(pick);
    // Don't treat a not-yet-loaded/failed profile as "unverified" — that would
    // route an already-verified human into the gate (→ nullifier_replayed).
    // Resolve `me` authoritatively when it isn't settled yet.
    let verified = hostUser?.worldVerified ?? false;
    if (meStatus !== "ready") {
      verified = await client.profile
        .me()
        .then((m) => m.worldVerified)
        .catch(() => false);
    }
    // Pass the pick directly (state isn't flushed yet on the non-gated path); the
    // world-gate path re-renders first, so its onVerified reads `chosen` from state.
    // DEMO: skip the World-ID gate (its RP context may be unconfigured) — go straight
    // to the build so a fresh, unverified demo account can complete the flow.
    if (!DEMO_MODE && !verified) go("worldgate");
    else startBuild(pick);
  };

  const startBuild = async (pick?: Chosen) => {
    const c = pick ?? chosen;
    go("workshop");
    try {
      // Fire the real build; the workshop then polls builds.status for progress.
      const res = await client.builds.create({
        spec: spec!,
        prompt: idea,
        attachmentKeys,
        draftId: draftId as BuildDraftId,
        ...(c?.agentId ? { agentId: c.agentId as BuilderAgentId } : {}),
        ...(c?.payment ? { payment: c.payment } : {}),
      });
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
          onLogin={() => openLogin()}
          onGo={() => idea.trim() && handleRefine()}
          attachments={attachments}
          uploading={uploading}
          onAttach={onAttach}
          onRemoveAttachment={removeAttachment}
          drafts={otherDrafts}
          onResumeDraft={(id, s) => router.push(`/build?d=${id}&step=${s}`)}
          onDiscardDraft={discardDraft}
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

      {step === "worldgate" && (
        <WorldGate onVerified={() => startBuild(chosen ?? undefined)} />
      )}

      {step === "workshop" && spec && (
        <WorkshopBeat
          spec={spec}
          username={username}
          buildId={buildId}
          onDone={(slug) => {
            setRevealSlug(slug);
            go("reveal");
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
  attachments,
  uploading,
  onAttach,
  onRemoveAttachment,
  drafts,
  onResumeDraft,
  onDiscardDraft,
}: {
  idea: string;
  setIdea: (v: string) => void;
  remix: string | null;
  busy: boolean;
  err: string | null;
  isLoggedIn: boolean;
  onLogin: () => void;
  onGo: () => void;
  attachments: Attachment[];
  uploading: boolean;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (key: string) => void;
  drafts: { id: string; step: string; prompt: string; name: string | null; iconEmoji: string | null }[];
  onResumeDraft: (id: string, step: string) => void;
  onDiscardDraft: (id: string) => void;
}) {
  const atCap = attachments.length >= BUILD_ATTACH_MAX;
  return (
    <div className="flex flex-1 flex-col gap-4">
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
      <div className="relative">
        <Textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={3}
          placeholder="what should it do?"
          className="leading-relaxed shadow-sticker pr-14"
        />
        <MicButton
          value={idea}
          onChange={setIdea}
          className="absolute bottom-2.5 right-2.5"
        />
      </div>

      {/* Reference attachments — images (mockups/sketches) + docs (CSV/Excel/PDF). */}
      {isLoggedIn && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className={cx(
                "inline-flex items-center gap-1.5 bg-cream border-2 border-ink rounded-full px-3 py-1.5 text-small font-bold sticker-press cursor-pointer",
                (uploading || atCap) && "opacity-50 pointer-events-none"
              )}
            >
              {uploading ? "uploading…" : "📎 Attach"}
              <input
                type="file"
                multiple
                accept="image/*,.csv,.pdf,.xls,.xlsx,text/plain"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) onAttach(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-tiny font-semibold text-muted">
              images, CSV, PDF — up to {BUILD_ATTACH_MAX}, {ATTACH_MAX_MB}MB each
            </span>
          </div>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span
                  key={a.key}
                  className="inline-flex items-center gap-1.5 bg-card border-2 border-ink rounded-full pl-2.5 pr-1.5 py-1 text-tiny font-bold"
                >
                  {a.mime.startsWith("image/") ? "🖼" : "📄"} {a.name.slice(0, 24)}
                  <button
                    onClick={() => onRemoveAttachment(a.key)}
                    aria-label={`Remove ${a.name}`}
                    className="focus-ring grid place-items-center w-4 h-4 rounded-full bg-ink text-cream text-[10px] leading-none"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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

      {drafts.length > 0 && (
        <div className="mt-2 flex flex-col gap-2.5">
          <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            More drafts
          </div>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {drafts.map((d) => (
              <StickerCard key={d.id} color="cream" className="p-3 flex items-center gap-3">
                <EmojiToken emoji={d.iconEmoji ?? "✏️"} color="yellow" size={36} rounded="toy" />
                <div className="flex flex-col min-w-0">
                  <div className="font-extrabold text-small truncate">
                    {d.name ?? d.prompt ?? "Untitled idea"}
                  </div>
                  <div className="text-tiny font-semibold text-muted">draft · paused</div>
                </div>
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onResumeDraft(d.id, d.step)}
                    className="focus-ring whitespace-nowrap border-2 border-ink rounded-full bg-pink text-white px-3 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
                  >
                    Resume →
                  </button>
                  <button
                    onClick={() => onDiscardDraft(d.id)}
                    aria-label="discard draft"
                    className="focus-ring text-muted font-extrabold px-1.5 text-body"
                  >
                    ✕
                  </button>
                </div>
              </StickerCard>
            ))}
          </div>
        </div>
      )}

      {isLoggedIn && <BuildHistory />}
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
          <MicButton value={draft} onChange={setDraft} size={48} />
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
        <MicButton value={draft} onChange={setDraft} size={48} />
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
  builders: Builder[] | null;
  onPick: (b: Builder) => void;
  onInfo: (id: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="text-h2 font-extrabold">Who makes it?</div>
        <div className="text-small font-medium text-muted">
          each is a real AI builder — its own wallet, on-chain identity & a USDC stake on the line
        </div>
      </div>
      {builders === null ? (
        <div className="flex flex-col gap-3">
          <div className="h-[150px] bg-card border-2 border-ink rounded-toy-lg animate-pulse" />
          <div className="h-[150px] bg-card border-2 border-ink rounded-toy-lg animate-pulse" />
        </div>
      ) : builders.length === 0 ? (
        <StickerCard className="p-5 flex flex-col items-center gap-2 text-center">
          <EmojiToken emoji="🛠️" color="blue" size={48} rounded="toy" />
          <div className="font-extrabold text-body">no builders around right now</div>
          <div className="text-small font-semibold text-muted">give it a moment and try again</div>
        </StickerCard>
      ) : (
        <div className="flex flex-col gap-3.5">
          {builders.map((b) => {
            const free = Number(b.priceUsdc) === 0;
            const tv = builderEmoji(b.priceUsdc);
            return (
              <StickerCard key={b.id} className="p-4 flex flex-col gap-3">
                {/* header: identity token + name + tier */}
                <div className="flex items-start gap-3">
                  <EmojiToken emoji={tv.emoji} color={tv.color} size={46} rounded="toy" tilt={-4} />
                  <div className="flex flex-col min-w-0 flex-1 gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-body truncate">{b.name}</span>
                      <TierChip model={b.model} />
                    </div>
                    <MakerLine username={b.owner.username} worldVerified={b.owner.worldVerified} />
                  </div>
                </div>
                {/* what it can build */}
                <CapChips capabilities={b.capabilities} />
                {/* the per-agent trust signals (stake + human-backed, only where true) */}
                <TrustRow stakedUsdc={b.stakedUsdc} agentbookRegistered={b.agentbookRegistered} />
                {/* actions */}
                <div className="flex items-center gap-2 pt-2.5 border-t-2 border-dashed border-ink/15">
                  <button
                    onClick={() => onInfo(b.id)}
                    className="focus-ring inline-flex items-center gap-1.5 text-small font-extrabold text-blue sticker-press"
                  >
                    <span className="inline-flex size-5 items-center justify-center rounded-full border-2 border-ink bg-card text-tiny">
                      ⓘ
                    </span>
                    Profile
                  </button>
                  <button
                    onClick={() => onPick(b)}
                    className={cx(
                      "focus-ring ml-auto inline-flex items-center gap-1.5 whitespace-nowrap border-2 border-ink rounded-toy px-4 py-2 text-small font-extrabold shadow-sticker-sm sticker-press",
                      free ? "bg-green text-ink" : "bg-pink text-white"
                    )}
                  >
                    {free ? "Pick · Free" : `Pick · ${b.priceUsdc} USDC`}
                    <span aria-hidden>→</span>
                  </button>
                </div>
              </StickerCard>
            );
          })}
        </div>
      )}
    </>
  );
}

type StepEvent = { t: number; kind: "tool" | "text" | "error" | "status"; label: string };

/** "+0.0s" / "+3.2s" / "+1m04s" — elapsed since the first step. */
function fmtDelta(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `+${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `+${m}m${String(Math.floor(s % 60)).padStart(2, "0")}s`;
}

/** "3.4s" / "1m04s" — a duration. */
function fmtDur(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.floor(s % 60)).padStart(2, "0")}s`;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago". */
function relTime(d: string | number | Date): string {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (Number.isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function buildBadge(status: string) {
  if (status === "done") return <Badge color="green">done</Badge>;
  if (status === "failed") return <Badge color="pink">failed</Badge>;
  return <Badge color="yellow">building…</Badge>;
}

/** The real per-step timeline, read from build.events (live + historical). */
function StepTimeline({ events, running }: { events: StepEvent[]; running?: boolean }) {
  if (events.length === 0) {
    return (
      <div className="w-full flex items-center gap-2.5 text-small font-bold text-muted">
        <span className="size-5 rounded-full border-2 border-ink bg-card flex items-center justify-center text-tiny animate-pulse">
          …
        </span>
        {running ? "warming up the workshop…" : "no steps recorded"}
      </div>
    );
  }
  const start = events[0]?.t ?? 0;
  return (
    <div className="w-full flex flex-col gap-2.5">
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const err = e.kind === "error";
        const active = running && last && !err;
        return (
          <div
            key={`${e.t}-${i}`}
            className={cx(
              "flex items-center gap-2.5 text-small font-bold",
              err ? "text-pink" : "text-ink"
            )}
          >
            <span
              className={cx(
                "size-5 rounded-full border-2 border-ink flex items-center justify-center text-tiny shrink-0",
                err ? "bg-pink text-white" : active ? "bg-card animate-pulse" : "bg-green"
              )}
            >
              {err ? "!" : active ? "…" : "✓"}
            </span>
            <span className="min-w-0 flex-1 break-words">{e.label}</span>
            <span className="text-tiny font-semibold text-muted shrink-0 tabular-nums">
              {fmtDelta(e.t - start)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  // Poll the real build — the step timeline, completion + reveal slug all come
  // from the DB (build.events / status), the single source of truth.
  useEffect(() => {
    if (!buildId) {
      // create() didn't land (free build spent / signed out) — finish as a demo.
      const t = setTimeout(() => onDone(spec.slug), 4200);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await client.builds.status({ buildId: buildId as BuildId });
        if (cancelled) return;
        if (Array.isArray(s.events)) setEvents(s.events as StepEvent[]);
        if (s.status === "failed") {
          setFailed(s.error ?? "couldn't finish this jam");
          return;
        }
        if (
          s.status === "done" &&
          (s.appStatus === "listed" || s.appStatus === "deployed")
        ) {
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
      <div className="mt-1 w-full">
        <StepTimeline events={events} running />
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
    <div className="flex flex-col items-center gap-4 py-4 text-center animate-pop">
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

type BuildRow = {
  id: string;
  prompt: string;
  status: string;
  error: string | null;
  durationMs: number | null;
  createdAt: string | number | Date;
  appId: string | null;
  slug: string | null;
  appStatus: string | null;
  name: string;
  iconEmoji: string;
};

/** Past builds + their persisted step timelines (read from build.events). */
function BuildHistory() {
  const client = usePlatformClient();
  const [rows, setRows] = useState<BuildRow[] | null>(null);
  const [open, setOpen] = useState<BuildRow | null>(null);

  useEffect(() => {
    client.builds
      .list()
      .then((r) => setRows(r as BuildRow[]))
      .catch(() => setRows([]));
  }, [client]);

  if (!rows || rows.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2.5">
      <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
        Your builds
      </div>
      {rows.map((b) => (
        <button key={b.id} onClick={() => setOpen(b)} className="text-left">
          <StickerCard className="p-3 flex items-center gap-3">
            <EmojiToken emoji={b.iconEmoji} color="yellow" size={36} rounded="toy" />
            <div className="flex min-w-0 flex-col">
              <div className="truncate text-small font-extrabold">{b.name}</div>
              <div className="text-tiny font-semibold text-muted">
                {relTime(b.createdAt)}
                {b.durationMs ? ` · ${fmtDur(b.durationMs)}` : ""}
              </div>
            </div>
            <span className="ml-auto shrink-0">{buildBadge(b.status)}</span>
          </StickerCard>
        </button>
      ))}
      {open && <BuildDetailSheet build={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A build's stored step timeline — live-polls while in-flight, static once done. */
function BuildDetailSheet({ build, onClose }: { build: BuildRow; onClose: () => void }) {
  const client = usePlatformClient();
  const router = useRouter();
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [status, setStatus] = useState<string>(build.status);
  const [error, setError] = useState<string | null>(build.error);
  const [slug, setSlug] = useState<string | null>(build.slug);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const inflight = (s: string) => s !== "done" && s !== "failed";
    const poll = async () => {
      try {
        const r = await client.builds.status({ buildId: build.id as BuildId });
        if (cancelled) return;
        if (Array.isArray(r.events)) setEvents(r.events as StepEvent[]);
        setStatus(r.status);
        setError(r.error);
        if (r.slug) setSlug(r.slug);
        if (inflight(r.status)) timer = setTimeout(poll, 1500);
      } catch {
        /* transient */
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, build.id]);

  const running = status !== "done" && status !== "failed";
  return (
    <ToyboxSheet open onOpenChange={(o) => !o && onClose()} title={build.name} className="gap-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-small font-semibold text-muted">
          {build.prompt}
        </span>
        {buildBadge(status)}
      </div>
      <StepTimeline events={events} running={running} />
      {status === "failed" && error && (
        <div className="break-words rounded-toy border-2 border-pink bg-cream px-3 py-2 text-small font-semibold text-pink">
          {error}
        </div>
      )}
      {status === "done" && slug && (
        <StickerButton color="pink" size="lg" block onClick={() => router.push(`/app/${slug}`)}>
          ▸ Play
        </StickerButton>
      )}
      {status === "failed" && (
        <StickerButton color="white" size="lg" block onClick={() => router.push("/build")}>
          Try again
        </StickerButton>
      )}
    </ToyboxSheet>
  );
}
