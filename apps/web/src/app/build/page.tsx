"use client";

// Make — idea → jam (DESIGN_BRIEF §3c). A sequence of beats, never a labelled
// wizard: idea → follow-ups → plan → workshop → reveal. The platform auto-routes
// the build to the house builder, so there's no builder-pick beat.
// Machinery hidden throughout: no build logs, file names, terminals, or
// "AI/agent" talk anywhere a user can see.
import type { AppSpec, BuildDraftId, BuildId, RefineResult, Similar } from "@superjam/shared";
import { ATTACH_MAX_MB, BUILD_ATTACH_MAX } from "@superjam/shared";
import { useLogin } from "../../components/login";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { cx } from "../../components/ui/cx";
import { Badge } from "../../components/ui/badge";
import { Input, Textarea } from "../../components/ui/field";
import { MicButton } from "../../components/ui/mic-button";
import { actionRowButton, EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { usePlatformClient } from "../../components/use-platform-client";
import { useHostAuth } from "../../lib/use-host-auth";
import { useBuildDraft } from "../../lib/use-build-draft";

type Step = "home" | "followups" | "plan" | "workshop" | "reveal";

/** An uploaded reference attachment (image or doc) for the build prompt. */
interface Attachment {
  key: string;
  name: string;
  mime: string;
}

/** Non-image MIME types the upload pipeline accepts (mirrors the 📎 input's `accept`
 *  + the server's ALLOWED_UPLOAD_MIME). Images are matched by the `image/` prefix. */
const PASTE_DOC_MIMES = new Set([
  "text/csv",
  "text/plain",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Whether a pasted/dropped file is something we can attach. */
const isAttachable = (f: File): boolean =>
  f.type.startsWith("image/") || PASTE_DOC_MIMES.has(f.type);

/** Read a File as a base64 data URL (the upload endpoint strips the prefix). */
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });

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
  const { hostUser, isLoggedIn } = useHostAuth();
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
  const [exchange, setExchange] = useState<{ you: string; back: string }[]>([]);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [revealSlug, setRevealSlug] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // --- resumable draft (URL + localStorage + DB) — survives reload / sign-in
  //     round-trip, so the wizard resumes instead of resetting to home. ---
  const { draftId, persist, load } = useBuildDraft({
    initialDraftId: search.get("d"),
    isLoggedIn,
  });
  const [hydrated, setHydrated] = useState(false);

  // The current step is DERIVED from the URL — no state, no URL↔state sync effect
  // (react.dev "You Might Not Need an Effect"). Transitions navigate via go(), which
  // also carries the draft id + remix so a reload/back/forward resumes the right step.
  // Legacy drafts may carry the removed "builder" step — collapse it to the plan
  // so resuming one lands on a real beat (the user re-taps "Make it!").
  const urlStep = search.get("step");
  const step: Step = urlStep === "builder" ? "plan" : ((urlStep as Step | null) ?? "home");
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
        // Hydrate ONLY values the draft actually carries — NEVER overwrite
        // something the user produced while this async load was in flight. A
        // fast refine fired right after mount can set a real spec + navigate to
        // the plan BEFORE load() resolves; the old unconditional
        // `setSpec(snap.spec)` (snap.spec === null for a home-stage draft) then
        // wiped that spec, so `step === "plan" && spec` went false and the
        // screen showed nothing. Same for a just-typed idea / fresh attachments.
        const s = snap.state ?? {};
        if (snap.prompt) setIdea(snap.prompt);
        if (snap.spec) setSpec(snap.spec);
        if (s.questions?.length) setQuestions(s.questions);
        if (s.picks && Object.keys(s.picks).length) setPicks(s.picks as Record<number, string>);
        if (s.comments?.length) setComments(s.comments);
        if (s.exchange?.length) setExchange(s.exchange);
        if (s.similar?.length) setSimilar(s.similar);
        if (s.attachments?.length) setAttachments(s.attachments as Attachment[]);
        if (s.revealSlug) setRevealSlug(s.revealSlug);
        if (snap.buildId) setBuildId(snap.buildId);
      }
      // Read the LIVE url (not the mount-time `search` snapshot): if the user
      // already navigated (e.g. a refine pushed ?step=plan) while load() ran, a
      // replace built from the stale snapshot would yank them back to home. So
      // we only inject the missing ?d / resume token, and always preserve the
      // step the URL currently shows.
      const live = new URLSearchParams(window.location.search);
      const liveStep = live.get("step");
      const needD = live.get("d") !== draftId;
      const resumeStep = !liveStep && snap?.step && snap.step !== "home" ? snap.step : null;
      if (needD || resumeStep) {
        const params = new URLSearchParams();
        if (remixSlug) params.set("remix", remixSlug);
        params.set("d", draftId);
        params.set("step", liveStep ?? resumeStep ?? "home");
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
      state: { questions, picks, comments, exchange, similar, attachments, revealSlug },
      buildId,
    });
    // `persist` is included so the login transition (it captures isLoggedIn) re-fires
    // the save → a draft started signed-out is ADOPTED to the account after sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist, hydrated, step, idea, spec, questions, picks, comments, exchange, similar, attachments, buildId, revealSlug]);

  // Other PENDING drafts (for the "pick up where you left off" banner on home).
  const [otherDrafts, setOtherDrafts] = useState<
    { id: string; step: string; prompt: string; name: string | null; iconEmoji: string | null; updatedAt: string }[]
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
              updatedAt: String(r.updatedAt),
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
    async (files: FileList | File[]) => {
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

  // Paste an image (or allowed doc) straight into the idea box → attach it via the
  // SAME upload pipeline as the 📎 button, instead of the browser dropping the file's
  // NAME into the textarea as text. We read both clipboardData.files AND .items (the
  // two ways browsers expose pasted files — a clipboard image vs a copied file), keep
  // only attachable types, and only preventDefault when we actually found bytes — so a
  // plain-text paste still types normally. NOTE: copying a FILE in Finder often hands
  // the page only the filename (no bytes); copying the IMAGE itself (a screenshot, or
  // "Copy Image") carries bytes and attaches.
  const onPasteFiles = useCallback(
    (e: React.ClipboardEvent) => {
      if (!isLoggedIn) return; // uploads.create is protected + the attach UI is login-gated
      const dt = e.clipboardData;
      if (!dt) return;
      const fromItems = Array.from(dt.items)
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      const seen = new Set<string>();
      const files = [...Array.from(dt.files), ...fromItems].filter(
        (f) => isAttachable(f) && !seen.has(f.name + f.size) && seen.add(f.name + f.size)
      );
      if (files.length === 0) return; // nothing attachable → let the default paste happen
      e.preventDefault();
      onAttach(files);
    },
    [isLoggedIn, onAttach]
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
        // Branch on the PAYLOAD, not just `type`. A spec always wins (→ plan);
        // follow-ups only when there are real questions. `spec`/`questions` are
        // both optional in the schema, so a degenerate result (a `type` with an
        // empty payload — which Gemini can emit on the image/multimodal path)
        // used to match NEITHER old branch and silently leave the user staring
        // at the home screen. Now any usable payload advances, and anything else
        // surfaces a retry instead of doing nothing.
        if (res.spec) {
          setSpec(res.spec);
          go("plan");
        } else if (res.questions?.length) {
          setQuestions(res.questions);
          go("followups");
        } else {
          setErr("hmm, I didn't quite catch that — mind trying once more?");
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

  const startBuild = async () => {
    go("workshop");
    try {
      // Fire the real build; the workshop then polls builds.status for progress.
      // No builder pick — the platform auto-routes to the house builder.
      const res = await client.builds.create({
        spec: spec!,
        prompt: idea,
        attachmentKeys,
        draftId: draftId as BuildDraftId,
      });
      setBuildId(res.buildId);
    } catch {
      // Sign-in needed / builder unavailable — the workshop falls back to its
      // animation and the reveal opens the spec slug.
    }
  };

  return (
    <div className="screen">
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
          onPasteFiles={onPasteFiles}
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
          onMake={startBuild}
        />
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


// Clickable idea scaffolds under the input. All phrased to hit a build KIT
// (poll/quiz/guestbook/tap-arcade/travel) so they build fast + reliably — and they
// double as a "what can I make?" showcase. ~4 freshly shuffled show each visit.
const IDEA_EXAMPLES = [
  "a live poll: pineapple on pizza, yes or no",
  "this or that: cats vs dogs with a live tally",
  "a 5-question trivia quiz with a leaderboard",
  "a flag-guessing quiz with a global high score",
  "an anonymous hot-takes wall",
  "a birthday wall for a friend",
  "a clicker where you boop a capybara",
  "a reaction-time game with a global best",
  "a 3-day tokyo food crawl on a map",
  "a road-trip guide down the california coast",
  "a tip jar with a leaderboard",
  "a doodle guessing duel",
];

const shuffledExamples = (n: number): string[] => {
  const a = [...IDEA_EXAMPLES];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
};

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
  onPasteFiles,
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
  onAttach: (files: FileList | File[]) => void;
  onPasteFiles: (e: React.ClipboardEvent) => void;
  onRemoveAttachment: (key: string) => void;
  drafts: { id: string; step: string; prompt: string; name: string | null; iconEmoji: string | null; updatedAt: string }[];
  onResumeDraft: (id: string, step: string) => void;
  onDiscardDraft: (id: string) => void;
}) {
  const atCap = attachments.length >= BUILD_ATTACH_MAX;
  // Hydration-safe: render a fixed slice on the server, reshuffle on mount so the
  // set varies per visit without an SSR/client Math.random mismatch.
  const [picks, setPicks] = useState<string[]>(() => IDEA_EXAMPLES.slice(0, 4));
  useEffect(() => setPicks(shuffledExamples(4)), []);
  // Resume list: show the most recent few; expand inline rather than nesting a
  // scroll area inside the page (which clipped cards mid-row and read as broken).
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const visibleDrafts = showAllDrafts ? drafts : drafts.slice(0, 3);
  return (
    <div className="flex flex-1 flex-col gap-4">
      {remix && (
        <div className="bg-card border border-line rounded-toy px-3.5 py-2.5 text-small font-semibold text-muted shadow-sticker-sm">
          Based on <span className="font-bold text-ink">{remix}</span> — say your changes
        </div>
      )}
      <div className="flex flex-col gap-2 mt-2">
        <div className="text-hero font-extrabold tracking-display leading-[1.03]">
          {remix ? "Your changes" : "Dream up"}
          {!remix && (
            <>
              <br />a little app.
            </>
          )}
        </div>
        <div className="text-body font-medium text-muted prose-body">
          Say it in a sentence — we'll make it real.
        </div>
      </div>
      <div className="relative mt-1">
        <Textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onPaste={onPasteFiles}
          rows={3}
          placeholder="what should it do?"
          className="leading-relaxed px-5 py-4 shadow-soft pr-14"
        />
        <MicButton
          value={idea}
          onChange={setIdea}
          className="absolute bottom-2.5 right-2.5"
        />
      </div>

      {/* lightweight idea scaffolds, right under the box — click to prefill */}
      <div className="stagger flex flex-wrap items-center gap-1.5">
        <span className="text-tiny font-bold text-muted">try:</span>
        {picks.map((ex) => (
          <button
            key={ex}
            onClick={() => setIdea(ex)}
            className="focus-ring rounded-full border border-line bg-card px-3 py-1 text-tiny font-semibold text-muted hover:text-ink sticker-press"
          >
            {ex}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPicks(shuffledExamples(4))}
          aria-label="Shuffle suggestions"
          className="focus-ring rounded-full border border-line bg-card px-3 py-1 text-tiny font-semibold text-muted hover:text-ink sticker-press"
        >
          shuffle
        </button>
      </div>

      {/* Reference attachments — images (mockups/sketches) + docs (CSV/Excel/PDF). */}
      {isLoggedIn && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className={cx(
                "inline-flex items-center gap-1.5 bg-card border border-line rounded-full px-3 py-1.5 text-small font-semibold text-muted hover:text-ink sticker-press cursor-pointer",
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
              images, CSV, PDF — or paste · up to {BUILD_ATTACH_MAX}, {ATTACH_MAX_MB}MB each
            </span>
          </div>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span
                  key={a.key}
                  className="inline-flex items-center gap-1.5 bg-card border border-line rounded-full pl-2.5 pr-1.5 py-1 text-tiny font-bold"
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
        // Confident solid primary: pink (the one hero accent) the moment there's an
        // idea; solid ink while the box is empty, so the CTA is always high-contrast
        // and clearly visible — never the old washed-out cream-on-cream ghost.
        <StickerButton
          color={idea.trim() ? "pink" : "ink"}
          size="lg"
          block
          onClick={onGo}
          disabled={busy || !idea.trim()}
        >
          {busy ? "thinking…" : "Let's go →"}
        </StickerButton>
      ) : (
        // refine is a protected call — a signed-out maker would just 401. Send
        // them through sign-in first; their idea text stays in the box.
        <StickerButton color="pink" size="lg" block onClick={onLogin}>
          Sign in to make →
        </StickerButton>
      )}

      {drafts.length > 0 && (
        <div className="mt-5 flex flex-col gap-2.5">
          <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            Pick up where you left off
          </div>
          <div className="stagger flex flex-col gap-2">
            {visibleDrafts.map((d) => (
              <div key={d.id} className="group relative">
                {/* Whole card resumes — a quiet hover chevron stands in for the old
                    black pill. The ✕ is a sibling (never nested in the button). */}
                <button
                  onClick={() => onResumeDraft(d.id, d.step)}
                  className={cx(
                    actionRowButton,
                    "gap-2.5 p-2.5 pr-9 shadow-none hover:shadow-sticker-sm"
                  )}
                >
                  <EmojiToken
                    emoji={d.iconEmoji ?? "✦"}
                    color="cream"
                    size={30}
                    rounded="toy"
                  />
                  <div className="flex min-w-0 flex-col">
                    <div className="line-clamp-1 text-small font-extrabold leading-snug">
                      {d.name ?? d.prompt ?? "Untitled idea"}
                    </div>
                    <div className="truncate text-tiny font-semibold text-muted">
                      {d.step === "home" ? "idea" : `paused at ${stepLabel(d.step)}`} ·{" "}
                      {relTime(d.updatedAt)}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    className="ml-auto text-body font-bold text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                  >
                    →
                  </span>
                </button>
                <button
                  onClick={() => onDiscardDraft(d.id)}
                  aria-label="discard draft"
                  className="focus-ring absolute right-1.5 top-1.5 px-1 text-small font-extrabold text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {drafts.length > 3 && (
            <button
              onClick={() => setShowAllDrafts((v) => !v)}
              className="focus-ring self-center text-tiny font-bold text-muted hover:text-ink sticker-press"
            >
              {showAllDrafts ? "Show less ↑" : `Show ${drafts.length - 3} more ↓`}
            </button>
          )}
        </div>
      )}
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
      <div className="flex flex-col gap-2 mt-2">
        <div className="text-h2 font-extrabold tracking-display">A couple of details.</div>
        <div className="text-body font-medium text-muted prose-body">
          Two quick things before we draw up the plan.
        </div>
      </div>

      {similar.length > 0 && (
        <StickerCard className="p-4 flex flex-col gap-2.5">
          <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            similar jams already exist
          </div>
          {similar.slice(0, 3).map((s) => (
            <button
              key={s.slug}
              onClick={() => onOpenSimilar(s)}
              className="focus-ring flex items-center gap-2 text-left text-small font-semibold"
            >
              <span className="font-bold">{s.slug}</span>
              <span className="text-muted">— {s.reason}</span>
              <span className="ml-auto text-pink text-tiny font-extrabold">Open ›</span>
            </button>
          ))}
        </StickerCard>
      )}

      <div className="stagger flex flex-col gap-4">
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="text-body font-bold">{q.q}</div>
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => (
                <button
                  key={o}
                  onClick={() => setPick(i, o)}
                  className={cx(
                    "focus-ring border border-line rounded-full px-4 py-2 text-small sticker-press",
                    picks[i] === o
                      ? "bg-ink text-white font-bold"
                      : "bg-card font-semibold text-muted hover:text-ink"
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
            className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2 text-small font-semibold"
          >
            <span className="size-1.5 rounded-full bg-pink border border-line shrink-0" />
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
            className="focus-ring size-12 shrink-0 bg-card border border-line rounded-full text-xl font-extrabold text-muted hover:text-ink sticker-press"
            aria-label="Add comment"
          >
            +
          </button>
        </div>
      </div>

      <StickerButton color="pink" size="lg" block onClick={onDraw} disabled={busy}>
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
      <div className="flex flex-col gap-2 mt-2">
        <div className="text-h2 font-extrabold tracking-display">Here's the plan.</div>
        <div className="text-body font-medium text-muted prose-body">
          tweak anything — the plan keeps up
        </div>
      </div>

      <StickerCard className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <EmojiToken emoji={spec.iconEmoji} color="cream" size={56} rounded="toy" />
          <div className="flex flex-col min-w-0">
            <div className="font-extrabold text-h3 truncate tracking-display">{spec.name}</div>
            <div className="text-small text-muted prose-body">
              {spec.description}
            </div>
          </div>
        </div>

        {/* ENS address row */}
        <div className="flex items-center gap-2 bg-paper border border-line rounded-toy px-3 py-2">
          <span className="size-1.5 rounded-full bg-pink shrink-0" />
          <span className="font-mono text-small font-bold truncate">
            {spec.slug}
            <span className="text-muted font-medium">.{username}.superjam.fun</span>
          </span>
          <Badge color="green" className="ml-auto border px-2">✓ free</Badge>
        </div>

        <div className="h-px bg-line" />

        <div className="flex flex-col gap-3">
          <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            What's inside
          </div>
          <div className="stagger flex flex-col gap-2.5">
          {spec.features.slice(0, 5).map((f, i) => (
            <div key={i} className="flex items-center gap-2.5 text-small font-semibold">
              <span className="size-6 rounded-full bg-paper border border-line flex items-center justify-center text-tiny font-bold text-muted tabular-nums shrink-0">
                {i + 1}
              </span>
              <span className="min-w-0">{f}</span>
            </div>
          ))}
          </div>
        </div>
      </StickerCard>

      {/* refine exchange */}
      {exchange.map((e, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="self-end max-w-[78%] bg-ink text-white rounded-toy rounded-br-sm px-3.5 py-2 text-small font-semibold shadow-sticker-sm">
            {e.you}
          </div>
          {e.back && (
            <div className="self-start max-w-[78%] bg-card border border-line rounded-toy rounded-bl-sm px-3.5 py-2 text-small font-semibold text-muted shadow-sticker-sm">
              {e.back}
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
          placeholder="change anything — just say it"
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
          className="focus-ring size-12 shrink-0 bg-ink text-white rounded-full text-lg font-extrabold sticker-press"
          aria-label="Send change"
        >
          ↑
        </button>
      </div>

      <StickerButton color="pink" size="lg" block onClick={onMake}>
        Make it →
      </StickerButton>
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

/** Friendly name for the make-flow beat a draft paused on (for draft cards). */
const STEP_LABEL: Record<string, string> = {
  followups: "Questions",
  plan: "the Plan",
  workshop: "Building",
  reveal: "Reveal",
};
const stepLabel = (s: string) => STEP_LABEL[s] ?? "draft";

/** "just now" / "5m ago" / "3h ago" / "2d ago". */
function relTime(d: string | number | Date): string {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (Number.isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The real per-step timeline, read from build.events (live + historical). */
function StepTimeline({ events, running }: { events: StepEvent[]; running?: boolean }) {
  if (events.length === 0) {
    return (
      <div className="w-full flex items-center gap-2.5 text-small font-bold text-muted">
        <span className="size-5 rounded-full border border-line bg-card flex items-center justify-center text-tiny animate-pulse">
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
                "size-5 rounded-full border border-line flex items-center justify-center text-tiny shrink-0",
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
          setFailed(s.error ?? "the workshop hit a snag — give it another go.");
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
        <EmojiToken emoji="😖" color="cream" size={72} rounded="toy" />
        <div className="text-h3 font-extrabold tracking-display">couldn't finish this jam</div>
        <div className="text-small text-muted max-w-[280px] prose-body">
          {failed}
        </div>
        <StickerButton color="pink" size="lg" onClick={() => location.assign("/build")}>
          Try again
        </StickerButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <EmojiToken emoji={spec.iconEmoji} color="cream" size={84} rounded="toy" className="shadow-sticker-lg" />
      <div className="text-h3 font-extrabold tracking-display">Making your jam…</div>
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
  const link = `superjam.fun/${username}/${slug}`;
  const copy = () => navigator.clipboard?.writeText(`https://${link}`).catch(() => {});
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center animate-pop">
      <EmojiToken emoji={spec.iconEmoji} color="cream" size={96} rounded="toy" className="shadow-sticker-lg" />
      <div className="text-h2 font-extrabold tracking-display">{spec.name} is live</div>
      <div className="inline-flex items-center gap-1.5 bg-card border border-line rounded-full pl-2.5 pr-3 py-1.5">
        <span className="size-1.5 rounded-full bg-pink" />
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
    </div>
  );
}
