"use client";

// Login seam for the new headless Dynamic SDK. The old SDK shipped a prebuilt
// modal (`setShowAuthFlow(true)`); the new one is headless, so we own the UI:
// email → one-time code, OR Continue with Google (OAuth redirect) → an embedded
// EVM wallet appears. Exposed app-wide via useLogin().openLogin(email?), with a
// single <LoginSheet> mounted under <Providers>. The OAuth return is completed by
// an effect in <LoginProvider>. "just your email / one tap, no seed phrase."
import {
  authenticateWithSocial,
  completeDeviceRegistration,
  completeSocialRedirect,
  detectDeviceRegistrationRedirect,
  detectOAuthRedirect,
  getDeviceRegistrationTokenFromUrl,
  isDeviceRegistrationRequired,
  logout,
  sendEmailOTP,
  verifyOTP,
} from "@dynamic-labs-sdk/client";
import {
  createWaasWalletAccounts,
  getChainsMissingWaasWalletAccounts,
} from "@dynamic-labs-sdk/client/waas";
import {
  useInitStatus,
  useOnEvent,
  useUser,
} from "@dynamic-labs-sdk/react-hooks";
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

const SOCIAL_FLAG = "sj_social_login";

// Mint the embedded EVM wallet if the freshly-signed-in user has none yet.
// (No-op when the environment auto-creates it.) Shared by the email + social paths.
async function ensureEvmWallet(): Promise<void> {
  const missing = getChainsMissingWaasWalletAccounts();
  if (missing.includes("EVM")) {
    await createWaasWalletAccounts({ chains: ["EVM"] });
  }
}

// Kick off Google sign-in. This redirects the whole page to Google; the browser
// returns to `redirectUrl`, where <LoginProvider>'s effect completes it. Callable
// from the welcome screen and the login sheet alike.
export async function signInWithGoogle(): Promise<void> {
  try {
    localStorage.setItem(SOCIAL_FLAG, "1");
  } catch {
    // localStorage may be unavailable (private mode) — non-fatal.
  }
  await authenticateWithSocial({
    provider: "google",
    redirectUrl: window.location.href,
  });
}

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
  const { data: initStatus } = useInitStatus();
  const { data: user } = useUser();

  const openLogin = useCallback((email?: string) => {
    setPrefill(email?.trim() ?? "");
    setOpen(true);
  }, []);

  // Device registration (2026_04_01 API). New-device sign-ins carry a
  // `device:register` scope the SDK won't clear until the device is verified via
  // an emailed link. Two parts: (1) when the browser returns from that link,
  // finish the registration here; (2) while a signed-in user still needs it,
  // block the app behind a "check your email" gate until it clears.
  const [deviceRegistered, setDeviceRegistered] = useState(false);
  useOnEvent({
    event: "deviceRegistrationCompleted",
    listener: () => setDeviceRegistered(true),
  });
  useOnEvent({
    event: "deviceRegistrationCompletedInAnotherTab",
    listener: () => setDeviceRegistered(true),
  });
  // A fresh login resets the latch so a different account can be gated again.
  useEffect(() => {
    if (!user) setDeviceRegistered(false);
  }, [user]);

  // Complete the device-registration email redirect on return. Strips the token
  // from the URL so a refresh doesn't re-fire and legit params survive.
  useEffect(() => {
    if (initStatus !== "finished") return;
    let cancelled = false;
    void (async () => {
      const url = new URL(window.location.href);
      if (!detectDeviceRegistrationRedirect({ url: url.href }) || cancelled) {
        return;
      }
      try {
        const deviceToken = getDeviceRegistrationTokenFromUrl({ url: url.href });
        await completeDeviceRegistration({ deviceToken });
        setDeviceRegistered(true);
      } catch {
        // surfaced through the gate; the user can re-open the email link
      } finally {
        window.history.replaceState(
          {},
          "",
          url.origin + url.pathname + url.hash
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initStatus]);

  const needsDeviceRegistration =
    initStatus === "finished" &&
    !deviceRegistered &&
    !!user &&
    isDeviceRegistrationRequired(user);

  // Complete a Google (OAuth) sign-in when the browser returns from the provider.
  // Gated on init so the client is ready; only strips the URL when it really was
  // an OAuth return (so a refresh doesn't re-fire and legit params survive).
  useEffect(() => {
    if (initStatus !== "finished") return;
    let cancelled = false;
    void (async () => {
      const url = new URL(window.location.href);
      let isReturn = false;
      try {
        isReturn = await detectOAuthRedirect({ url });
      } catch {
        return;
      }
      if (!isReturn || cancelled) return;
      try {
        await completeSocialRedirect({ url });
        await ensureEvmWallet();
      } catch {
        // surfaced through the login chrome; user can retry
      } finally {
        try {
          localStorage.removeItem(SOCIAL_FLAG);
        } catch {
          /* ignore */
        }
        window.history.replaceState(
          {},
          "",
          url.origin + url.pathname + url.hash
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initStatus]);

  return (
    <LoginContext.Provider value={{ openLogin }}>
      {children}
      <LoginSheet open={open} onOpenChange={setOpen} initialEmail={prefill} />
      {needsDeviceRegistration ? (
        <DeviceRegistrationGate email={user?.email ?? null} />
      ) : null}
    </LoginContext.Provider>
  );
}

// Full-screen block shown while a signed-in user must verify a new device. The
// SDK has already emailed the link (no extra call); this clears automatically on
// the `deviceRegistrationCompleted*` events or the email-redirect completion.
function DeviceRegistrationGate({ email }: { email: string | null }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-toy border border-line bg-card p-6 text-center shadow-sticker-lg">
        <EmojiToken emoji="📧" color="blue" size={64} tilt={-6} />
        <div className="text-h3 font-extrabold">Verify this device</div>
        <p className="text-small font-medium text-muted">
          For your security, we emailed a verification link
          {email ? (
            <>
              {" "}
              to <span className="font-bold text-ink">{email}</span>
            </>
          ) : null}
          . Open it to keep using SuperJam on this device — this page updates
          automatically once you do.
        </p>
        <button
          type="button"
          className="mt-1 text-small font-semibold text-muted underline"
          onClick={() => void logout()}
        >
          Use a different account
        </button>
      </div>
    </div>
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
      await ensureEvmWallet();
      onOpenChange(false);
    } catch {
      setError("That code didn't work — double-check and try again.");
    } finally {
      setBusy(false);
    }
  }, [otp, code, onOpenChange]);

  const google = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(); // redirects the page away on success
    } catch {
      setError("Couldn't start Google sign-in — try again or use email.");
      setBusy(false);
    }
  }, []);

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
            ? "one tap or your email — a wallet appears with it"
            : `we sent a code to ${email}`}
        </div>
      </div>

      {phase === "email" ? (
        <div className="flex flex-col gap-3">
          <StickerButton
            type="button"
            color="white"
            size="lg"
            block
            disabled={busy}
            onClick={() => void google()}
          >
            Continue with Google
          </StickerButton>

          <div className="flex items-center gap-3 text-tiny font-bold uppercase tracking-wide text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

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
              className="rounded-toy border border-line bg-cream px-4 py-3.5 text-body font-semibold outline-none placeholder:text-muted focus:border-pink"
            />
            <StickerButton type="submit" size="lg" block disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send me a code →"}
            </StickerButton>
          </form>
        </div>
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
            className="rounded-toy border border-line bg-cream px-4 py-3.5 text-center font-mono text-h3 font-bold tracking-[0.4em] outline-none placeholder:text-muted focus:border-pink"
          />
          <StickerButton type="submit" size="lg" block disabled={busy || !code.trim()}>
            {busy ? "Verifying…" : "Log in"}
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
