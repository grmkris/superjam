"use client";

// Welcome / onboarding (DESIGN_BRIEF §3a) — two beats:
//   1) email in → a wallet appears (Dynamic, %67's seam — we open setShowAuthFlow)
//   2) claim your name → kris.superjam.fun, and every jam hangs under it
// Machinery hidden: no "wallet" jargon, no seed phrase, no crypto talk.
import { useInitStatus } from "@dynamic-labs-sdk/react-hooks";
import { RESERVED_LABELS } from "@superjam/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../components/ui/cx";
import { Badge } from "../../components/ui/badge";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
import { JamBackdrop } from "../../components/ui/jam-backdrop";
import { signInWithGoogle, useLogin } from "../../components/login";
import { useHostAuth } from "../../lib/use-host-auth";
import { usePlatformClient } from "../../components/use-platform-client";

type Step = "email" | "claim";

const RESERVED = new Set<string>(RESERVED_LABELS as readonly string[]);
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,22}[a-z0-9])?$/;

type NameState = "empty" | "typing" | "available" | "taken" | "invalid";

function nameState(raw: string): NameState {
  const name = raw.trim().toLowerCase();
  if (!name) return "empty";
  if (!NAME_RE.test(name)) return "invalid";
  if (RESERVED.has(name)) return "taken";
  return "available";
}

export default function WelcomePage() {
  const router = useRouter();
  const { openLogin: startLogin } = useLogin();
  const { data: initStatus } = useInitStatus();
  const { isLoggedIn, hostUser } = useHostAuth();
  const client = usePlatformClient();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  // did the user drive a fresh login in THIS session? distinguishes a
  // first-timer (→ claim) from a returning user (→ straight to Discover).
  const droveLogin = useRef(false);
  // Where to land after sign-in — the route the gate bounced them from
  // (?next=). Internal paths only (no open-redirect, no /welcome loop).
  const nextRef = useRef<string>("/");
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("next");
    nextRef.current =
      raw && raw.startsWith("/") && !raw.startsWith("//") && raw !== "/welcome"
        ? raw
        : "/";
  }, []);
  const [name, setName] = useState("");
  const [claiming, setClaiming] = useState(false);
  // server-checked availability for the typed handle (format-gated, debounced).
  const [avail, setAvail] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");

  // Route on auth changes.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (droveLogin.current) {
      setStep("claim");
    } else {
      router.replace(nextRef.current);
    }
  }, [isLoggedIn, router]);

  // Prefill the claim field with the auto-derived handle once it loads.
  useEffect(() => {
    if (hostUser?.username && !name) setName(hostUser.username);
  }, [hostUser, name]);

  const openLogin = () => {
    droveLogin.current = true;
    startLogin(email);
  };

  // Live availability — debounced, server-authoritative (format gate first).
  useEffect(() => {
    const n = name.trim().toLowerCase();
    if (nameState(n) !== "available") {
      setAvail("idle");
      return;
    }
    setAvail("checking");
    let cancelled = false;
    const t = setTimeout(() => {
      client.profile
        .usernameAvailable({ username: n })
        .then((r) => {
          if (!cancelled) setAvail(r.ok ? "available" : "taken");
        })
        .catch(() => {
          if (!cancelled) setAvail("idle");
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, client]);

  // Effective chip/claim state: format first, then the server verdict — don't
  // flash "✓ free" until the server confirms uniqueness.
  const fmt = nameState(name);
  const state: NameState =
    fmt !== "available"
      ? fmt
      : avail === "available"
        ? "available"
        : avail === "taken"
          ? "taken"
          : "typing";
  const handle = name.trim().toLowerCase() || "your-name";

  const claim = async () => {
    if (state !== "available") return;
    setClaiming(true);
    try {
      await client.profile.claimUsername({
        username: name.trim().toLowerCase(),
      });
      router.push(nextRef.current);
    } catch {
      // taken / invalid — surface on the chip and let them pick another.
      setAvail("taken");
      setClaiming(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-cream text-ink overflow-hidden">
      {/* slide-1 floating jam tiles + sparkles, behind the sign-in card */}
      <JamBackdrop />

      <div className="relative z-10 mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center gap-6 px-5 py-16">
        {step === "email" ? (
          <EmailBeat
            email={email}
            setEmail={setEmail}
            onContinue={openLogin}
            ready={initStatus === "finished"}
          />
        ) : (
          <ClaimBeat
            name={name}
            setName={setName}
            state={state}
            handle={handle}
            onClaim={claim}
            claiming={claiming}
          />
        )}
      </div>
    </div>
  );
}

function EmailBeat({
  email,
  setEmail,
  onContinue,
  ready,
}: {
  email: string;
  setEmail: (v: string) => void;
  onContinue: () => void;
  ready: boolean;
}) {
  return (
    <>
      <div className="flex flex-col items-center gap-2.5">
        <EmojiToken emoji="⚡" color="yellow" size={84} tilt={-6} className="shadow-sticker-lg" />
        <div className="flex flex-col items-center gap-0.5">
          <div className="text-h1 font-extrabold">superjam</div>
          <div className="text-pink text-body font-semibold">
            make a jam. share the jam.
          </div>
        </div>
      </div>

      <StickerCard className="p-5 flex flex-col gap-3 shadow-sticker-lg" tilt={0}>
        <div className="text-center text-body font-bold">Hop in</div>
        <StickerButton
          type="button"
          color="cream"
          size="lg"
          block
          disabled={!ready}
          onClick={() => void signInWithGoogle()}
        >
          Continue with Google
        </StickerButton>
        <div className="flex items-center gap-2 text-tiny font-bold uppercase tracking-wide text-muted">
          <span className="h-px flex-1 bg-ink/15" />
          or
          <span className="h-px flex-1 bg-ink/15" />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onContinue();
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-label="Email address"
            placeholder="your email…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-cream border-2 border-ink rounded-toy px-4 py-3.5 text-body font-semibold placeholder:text-muted outline-none focus:border-pink"
          />
          <StickerButton type="submit" color="pink" size="lg" block disabled={!ready}>
            Continue →
          </StickerButton>
        </form>
        <div className="text-center text-tiny font-medium text-muted leading-snug px-1">
          a wallet appears with it — nothing to install, no seed phrase, no
          extension.
        </div>
      </StickerCard>
    </>
  );
}

function ClaimBeat({
  name,
  setName,
  state,
  handle,
  onClaim,
  claiming,
}: {
  name: string;
  setName: (v: string) => void;
  state: NameState;
  handle: string;
  onClaim: () => void;
  claiming: boolean;
}) {
  const previews = ["tipjar", "trivia"];
  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <EmojiToken emoji="🙂" color="green" size={72} rounded="toy" tilt={-6} />
        <div className="text-h1 font-extrabold text-center">
          Claim your name
        </div>
        <div className="text-body font-medium text-muted text-center">
          it's yours — your @handle on SuperJam
        </div>
      </div>

      <StickerCard className="p-5 flex flex-col gap-3 shadow-sticker-lg">
        {/* name-tag styled input */}
        <div
          className={cx(
            "flex items-center bg-cream border-2 rounded-toy px-3.5 py-3 gap-0.5",
            state === "available"
              ? "border-ink"
              : state === "invalid" || state === "taken"
                ? "border-pink"
                : "border-ink"
          )}
        >
          <span className="font-mono text-body font-medium text-muted">@</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Your name"
            placeholder="your-name"
            className="font-mono text-body font-bold bg-transparent outline-none flex-1 min-w-0"
          />
          <span className="ml-auto">{availChip(state)}</span>
        </div>

        {/* every jam hangs under it */}
        <div className="bg-cream border-2 border-ink rounded-xl px-3 py-2.5 flex flex-col gap-2">
          <div className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            Every jam you make hangs under it
          </div>
          {previews.map((p, i) => (
            <div key={p} className="flex items-center gap-1.5">
              <span
                className={cx(
                  "size-1.5 rounded-full border-[1.5px] border-ink shrink-0",
                  i === 0 ? "bg-yellow" : "bg-blue"
                )}
              />
              <span className="font-mono text-small font-semibold">
                <span className="text-muted">@{handle}/</span>
                {p}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full border-[1.5px] border-dashed border-muted bg-card shrink-0" />
            <span className="font-mono text-small font-semibold text-muted">
              @{handle}/your-next-jam
            </span>
          </div>
        </div>

        <StickerButton
          color="blue"
          size="lg"
          block
          onClick={onClaim}
          disabled={state !== "available" || claiming}
        >
          {claiming ? "Claiming…" : "That's me!"}
        </StickerButton>
      </StickerCard>
    </>
  );
}

function availChip(state: NameState) {
  switch (state) {
    case "available":
      return <Badge color="green">✓ free</Badge>;
    case "taken":
      return <Badge color="pink">taken</Badge>;
    case "invalid":
      return (
        <span className="text-tiny font-bold text-pink">a–z, 0–9, –</span>
      );
    default:
      return null;
  }
}
