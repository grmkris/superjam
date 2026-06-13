"use client";

// Welcome / onboarding (DESIGN_BRIEF §3a) — two beats:
//   1) email in → a wallet appears (Dynamic, %67's seam — we open setShowAuthFlow)
//   2) claim your name → kris.superjam.fun, and every jam hangs under it
// Machinery hidden: no "wallet" jargon, no seed phrase, no crypto talk.
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { RESERVED_LABELS } from "@superjam/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ROOT, userEns } from "../../components/ui/brand";
import { cx } from "../../components/ui/cx";
import { EmojiToken, StickerButton, StickerCard } from "../../components/ui/sticker";
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
  const { setShowAuthFlow, sdkHasLoaded } = useDynamicContext();
  const { isLoggedIn, hostUser } = useHostAuth();
  const client = usePlatformClient();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  // did the user drive a fresh login in THIS session? distinguishes a
  // first-timer (→ claim) from a returning user (→ straight to Discover).
  const droveLogin = useRef(false);
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
      router.replace("/");
    }
  }, [isLoggedIn, router]);

  // Prefill the claim field with the auto-derived handle once it loads.
  useEffect(() => {
    if (hostUser?.username && !name) setName(hostUser.username);
  }, [hostUser, name]);

  const openLogin = () => {
    droveLogin.current = true;
    setShowAuthFlow(true);
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
  const fullEns = userEns(name.trim().toLowerCase() || "your-name");

  const claim = async () => {
    if (state !== "available") return;
    setClaiming(true);
    try {
      await client.profile.claimUsername({
        username: name.trim().toLowerCase(),
      });
      router.push("/");
    } catch {
      // taken / invalid — surface on the chip and let them pick another.
      setAvail("taken");
      setClaiming(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-cream text-ink overflow-hidden">
      {/* floating toy stickers */}
      <span className="pointer-events-none absolute top-28 left-8 text-xl rotate-[-12deg]">🧸</span>
      <span className="pointer-events-none absolute top-40 right-9 text-lg rotate-[10deg]">🎯</span>
      <span className="pointer-events-none absolute top-64 left-12 text-sm rotate-[8deg]">✨</span>
      <span className="pointer-events-none absolute bottom-40 right-10 text-lg rotate-[-8deg]">🏷️</span>

      <div className="relative flex flex-1 flex-col justify-center gap-6 px-7 py-16">
        {step === "email" ? (
          <EmailBeat
            email={email}
            setEmail={setEmail}
            onContinue={openLogin}
            ready={sdkHasLoaded}
          />
        ) : (
          <ClaimBeat
            name={name}
            setName={setName}
            state={state}
            fullEns={fullEns}
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
          <div className="text-3xl font-extrabold">superjam</div>
          <div className="text-pink text-[15px] font-semibold">
            make a jam. share the jam.
          </div>
        </div>
      </div>

      <StickerCard className="p-5 flex flex-col gap-3 shadow-sticker-lg" tilt={0}>
        <div className="text-center text-[14.5px] font-bold">
          Hop in — just your email
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
            placeholder="your email…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-cream border-2 border-ink rounded-toy px-4 py-3.5 text-[15px] font-semibold placeholder:text-muted outline-none focus:border-pink"
          />
          <StickerButton type="submit" color="pink" size="lg" block disabled={!ready}>
            Continue →
          </StickerButton>
        </form>
        <div className="text-center text-xs font-medium text-muted leading-snug px-1">
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
  fullEns,
  onClaim,
  claiming,
}: {
  name: string;
  setName: (v: string) => void;
  state: NameState;
  fullEns: string;
  onClaim: () => void;
  claiming: boolean;
}) {
  const previews = ["tipjar", "trivia"];
  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <EmojiToken emoji="🙂" color="green" size={72} rounded="toy" tilt={-6} />
        <div className="text-[30px] font-extrabold leading-tight text-center">
          Claim your name
        </div>
        <div className="text-[14.5px] font-medium text-muted text-center">
          it's yours on the chain — forever
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
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="your-name"
            className="font-mono text-[14.5px] font-bold bg-transparent outline-none w-[7.5ch] min-w-0"
          />
          <span className="inline-block w-0.5 h-4 bg-pink" />
          <span className="font-mono text-[14.5px] font-medium text-muted">
            .{ROOT}
          </span>
          <span className="ml-auto">{availChip(state)}</span>
        </div>

        {/* every jam hangs under it */}
        <div className="bg-cream border-2 border-ink rounded-xl px-3 py-2.5 flex flex-col gap-2">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
            Every jam you make hangs under it
          </div>
          {previews.map((p, i) => (
            <div key={p} className="flex items-center gap-1.5">
              <span
                className={cx(
                  "w-1.5 h-1.5 rounded-full border-[1.5px] border-ink shrink-0",
                  i === 0 ? "bg-yellow" : "bg-blue"
                )}
              />
              <span className="font-mono text-[12px] font-semibold">
                {p}
                <span className="text-muted">.{fullEns}</span>
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full border-[1.5px] border-dashed border-muted bg-card shrink-0" />
            <span className="font-mono text-[12px] font-semibold text-muted">
              your-next-jam.{fullEns}
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
          {claiming ? "Claiming…" : "That's me! ⛓️"}
        </StickerButton>
      </StickerCard>
    </>
  );
}

function availChip(state: NameState) {
  switch (state) {
    case "available":
      return (
        <span className="inline-flex items-center gap-1 bg-green border-2 border-ink rounded-full px-2.5 py-0.5 text-[11px] font-extrabold">
          ✓ free
        </span>
      );
    case "taken":
      return (
        <span className="inline-flex items-center gap-1 bg-pink text-white border-2 border-ink rounded-full px-2.5 py-0.5 text-[11px] font-extrabold">
          taken
        </span>
      );
    case "invalid":
      return (
        <span className="text-[11px] font-bold text-pink">a–z, 0–9, –</span>
      );
    default:
      return null;
  }
}
