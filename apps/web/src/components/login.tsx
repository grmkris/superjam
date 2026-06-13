"use client";

// Login seam for the new headless Dynamic SDK. The old SDK shipped a prebuilt
// modal (`setShowAuthFlow(true)`); the new one is headless, so we own the UI:
// email → one-time code → an embedded EVM wallet appears. Exposed app-wide via
// useLogin().openLogin(email?), with a single <LoginSheet> mounted under
// <Providers>. Keeps the product's "just your email, no seed phrase" promise.
import { sendEmailOTP, verifyOTP } from "@dynamic-labs-sdk/client";
import {
  createWaasWalletAccounts,
  getChainsMissingWaasWalletAccounts,
} from "@dynamic-labs-sdk/client/waas";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { EmojiToken, StickerButton } from "./ui/sticker";
import { ToyboxSheet } from "./ui/sheet";

type OTPVerification = Awaited<ReturnType<typeof sendEmailOTP>>;

interface LoginApi {
  /** Open the login sheet. Pass an email to prefill + auto-send the code. */
  openLogin: (email?: string) => void;
}

const LoginContext = createContext<LoginApi | null>(null);

export function useLogin(): LoginApi {
  const ctx = useContext(LoginContext);
  if (!ctx) throw new Error("useLogin must be used within <LoginProvider>");
  return ctx;
}

export function LoginProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState("");

  const openLogin = useCallback((email?: string) => {
    setPrefill(email?.trim() ?? "");
    setOpen(true);
  }, []);

  return (
    <LoginContext.Provider value={{ openLogin }}>
      {children}
      <LoginSheet open={open} onOpenChange={setOpen} initialEmail={prefill} />
    </LoginContext.Provider>
  );
}

type Phase = "email" | "code";

function LoginSheet({
  open,
  onOpenChange,
  initialEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail: string;
}) {
  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState<OTPVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (addr: string) => {
    const clean = addr.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const verification = await sendEmailOTP({ email: clean });
      setOtp(verification);
      setPhase("code");
      setCode("");
    } catch {
      setError("Couldn't send the code — check the email and try again.");
      setPhase("email");
    } finally {
      setBusy(false);
    }
  }, []);

  // Reset on open. If an email was prefilled (welcome flow), auto-send so the
  // user lands straight on the code step.
  useEffect(() => {
    if (!open) return;
    setEmail(initialEmail);
    setCode("");
    setError(null);
    if (initialEmail) {
      void send(initialEmail);
    } else {
      setPhase("email");
    }
  }, [open, initialEmail, send]);

  const verify = useCallback(async () => {
    if (!otp || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOTP({ otpVerification: otp, verificationToken: code.trim() });
      // First-timers have no embedded wallet yet — mint the EVM one so an
      // address is ready. (No-op if the environment auto-created it.)
      const missing = getChainsMissingWaasWalletAccounts();
      if (missing.includes("EVM")) {
        await createWaasWalletAccounts({ chains: ["EVM"] });
      }
      onOpenChange(false);
    } catch {
      setError("That code didn't work — double-check and try again.");
    } finally {
      setBusy(false);
    }
  }, [otp, code, onOpenChange]);

  return (
    <ToyboxSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log in"
      dismissible={!busy}
      className="gap-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-col items-center gap-2 pt-1">
        <EmojiToken emoji="⚡" color="yellow" size={64} tilt={-6} />
        <div className="text-h3 font-extrabold">
          {phase === "email" ? "Hop in" : "Check your email"}
        </div>
        <div className="text-center text-small font-medium text-muted">
          {phase === "email"
            ? "just your email — a wallet appears with it"
            : `we sent a code to ${email}`}
        </div>
      </div>

      {phase === "email" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(email);
          }}
        >
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-label="Email address"
            placeholder="your email…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-toy border-2 border-ink bg-cream px-4 py-3.5 text-body font-semibold outline-none placeholder:text-muted focus:border-pink"
          />
          <StickerButton type="submit" color="pink" size="lg" block disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send me a code →"}
          </StickerButton>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Verification code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="rounded-toy border-2 border-ink bg-cream px-4 py-3.5 text-center font-mono text-h3 font-bold tracking-[0.4em] outline-none placeholder:text-muted focus:border-pink"
          />
          <StickerButton type="submit" color="blue" size="lg" block disabled={busy || !code.trim()}>
            {busy ? "Verifying…" : "Log in ⛓️"}
          </StickerButton>
          <button
            type="button"
            className="text-center text-small font-semibold text-muted underline disabled:opacity-50"
            disabled={busy}
            onClick={() => void send(email)}
          >
            Resend code
          </button>
        </form>
      )}

      {error ? (
        <div className="text-center text-small font-semibold text-pink">{error}</div>
      ) : null}
    </ToyboxSheet>
  );
}
