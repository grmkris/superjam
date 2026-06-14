"use client";

// WalletCard — the profile's single-balance wallet. Your balance IS your private
// (shielded) vault; public on-chain USDC is transient and auto-moves to private,
// so there's only ever one number. "Airdrop" drops test USDC (faucetPublic) and
// immediately shields it (depositPrivate) — coins rise into the balance. Any
// stray public USDC is swept to private on load. Toybox sticker language.
import { useCallback, useEffect, useRef, useState } from "react";
import { EmojiToken, StickerButton, StickerCard } from "../ui/sticker";
import { Skeleton } from "../ui/skeleton";
import { usePlatformClient } from "../use-platform-client";

const AIRDROP_USDC = "5";

type Bal = string | null | "loading";

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A USDC amount that tweens from its previous value to the new one (~0.6s) so a
 *  balance change reads as money actually arriving. `value` is the API decimal
 *  string ("4.0"); null → "0.00". */
function AnimatedUsdc({ value }: { value: string | null }) {
  const target = value === null ? 0 : Number(value);
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) {
      setShown(to);
      return;
    }
    const start = performance.now();
    const dur = 600;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) * (1 - t); // ease-out quad
      setShown(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [target]);

  return (
    <div className="text-hero font-extrabold leading-none">
      {shown.toFixed(2)} <span className="text-2xl text-muted">USDC</span>
    </div>
  );
}

export function WalletCard({ walletAddress }: { walletAddress: string | null }) {
  const client = usePlatformClient();
  const [priv, setPriv] = useState<Bal>("loading");
  const [busy, setBusy] = useState<null | "drop" | "shield">(null);
  const [error, setError] = useState<string | null>(null);
  const [flyKey, setFlyKey] = useState(0);
  const [flying, setFlying] = useState(false);
  const sweptRef = useRef(false);

  const refetch = useCallback(() => {
    client.payments
      .privateBalance()
      .then((b) => setPriv(b.shieldedUsdc))
      .catch(() => setPriv(null));
  }, [client]);

  const burst = useCallback(() => {
    setFlyKey((k) => k + 1);
    setFlying(true);
    window.setTimeout(() => setFlying(false), 1000);
  }, []);

  // Initial load + one-time sweep of any stray public USDC into private (keeps
  // the single-balance invariant). Both best-effort.
  useEffect(() => {
    refetch();
    if (sweptRef.current) return;
    sweptRef.current = true;
    client.payments
      .balance()
      .then(async (b) => {
        const pub = b.publicUsdc ? Number(b.publicUsdc) : 0;
        if (pub > 0) {
          try {
            await client.payments.depositPrivate({ amount: b.publicUsdc as string });
            burst();
            refetch();
          } catch {
            /* leave it public if the deposit can't land */
          }
        }
      })
      .catch(() => {});
  }, [client, refetch, burst]);

  const airdrop = async () => {
    setBusy("drop");
    setError(null);
    try {
      await client.payments.faucetPublic({ amount: AIRDROP_USDC });
      setBusy("shield");
      await client.payments.depositPrivate({ amount: AIRDROP_USDC });
      burst();
      refetch();
    } catch {
      setError("Airdrop failed — try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <StickerCard
      color="white"
      className="relative overflow-hidden p-5 flex flex-col gap-1 shadow-sticker-md"
    >
      <div className="flex items-center gap-1.5 text-tiny font-extrabold uppercase tracking-wide text-muted">
        your balance <span className="text-body leading-none">🔒</span> private
      </div>

      {priv === "loading" ? (
        <Skeleton className="mt-1 h-11 w-44" />
      ) : (
        <AnimatedUsdc value={priv} />
      )}

      <div className="text-small font-semibold text-muted">
        auto-private · airdrops land straight in your vault
      </div>

      <div className="mt-2 flex items-center gap-2">
        <StickerButton
          color="green"
          size="sm"
          disabled={busy !== null}
          onClick={airdrop}
          className="rounded-full"
        >
          {busy === "drop"
            ? "Airdropping…"
            : busy === "shield"
              ? "Shielding…"
              : `Airdrop $${AIRDROP_USDC} ↓`}
        </StickerButton>
        {walletAddress && (
          <button
            onClick={() => navigator.clipboard?.writeText(walletAddress).catch(() => {})}
            className="focus-ring ml-auto font-mono text-small font-semibold text-muted"
          >
            {short(walletAddress)} 📋
          </button>
        )}
      </div>

      {error && <div className="text-pink text-tiny font-bold mt-1">{error}</div>}

      {/* coins rise into the balance when money becomes private */}
      {flying && (
        <div
          key={flyKey}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center"
        >
          <span className="shield-rise absolute text-2xl" style={{ ["--rise" as string]: "-96px" }}>
            🪙
          </span>
          <span
            className="shield-rise absolute text-xl"
            style={{ ["--rise" as string]: "-84px", animationDelay: "0.08s", left: "44%" }}
          >
            💵
          </span>
          <span
            className="shield-rise absolute text-xl"
            style={{ ["--rise" as string]: "-104px", animationDelay: "0.16s", left: "56%" }}
          >
            🪙
          </span>
        </div>
      )}

      {/* a tiny vault glyph that pops when funds arrive */}
      {flying && (
        <EmojiToken
          emoji="🔒"
          color="green"
          size={28}
          className="animate-pop absolute right-4 top-4"
        />
      )}
    </StickerCard>
  );
}
