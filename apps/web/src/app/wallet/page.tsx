"use client";

// /wallet — the money showcase. Airdrop public Arc USDC into your own wallet,
// then watch it fly into your private vault when you shield it. Two live rails:
// ⚡ public (out in the open) and 🔒 shielded (the hero). Everything reuses
// existing payments endpoints — faucetPublic, balance, privateBalance,
// depositPrivate. Toybox sticker language (DESIGN_BRIEF §2).
import { useCallback, useEffect, useState } from "react";
import { StickerButton } from "../../components/ui/sticker";
import { useHostAuth } from "../../lib/use-host-auth";
import { useLogin } from "../../components/login";
import { usePlatformClient } from "../../components/use-platform-client";
import { BalanceRail } from "../../components/wallet/balance-rails";
import { AirdropButton } from "../../components/wallet/airdrop-button";
import { ShieldAction } from "../../components/wallet/shield-action";

type Bal = string | null | "loading";

export default function WalletPage() {
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();
  const { openLogin } = useLogin();

  const [pub, setPub] = useState<Bal>("loading");
  const [shielded, setShielded] = useState<Bal>("loading");
  const [flying, setFlying] = useState(false);
  const [flyKey, setFlyKey] = useState(0);

  const refresh = useCallback(() => {
    client.payments
      .balance()
      .then((b) => setPub(b.publicUsdc))
      .catch(() => setPub(null));
    client.payments
      .privateBalance()
      .then((b) => setShielded(b.shieldedUsdc))
      .catch(() => setShielded(null));
  }, [client]);

  useEffect(() => {
    if (!isLoggedIn) return;
    refresh();
  }, [isLoggedIn, refresh]);

  const startFlight = () => {
    setFlyKey((k) => k + 1);
    setFlying(true);
    window.setTimeout(() => setFlying(false), 1000);
  };

  if (!isLoggedIn) {
    return (
      <div className="screen items-center justify-center text-center">
        <div className="text-5xl">💸</div>
        <div className="font-extrabold text-h3">sign in to open your wallet</div>
        <StickerButton color="pink" size="lg" onClick={() => openLogin()}>
          Hop in →
        </StickerButton>
      </div>
    );
  }

  const pubValue = pub === "loading" ? null : pub;
  const shieldedValue = shielded === "loading" ? null : shielded;

  return (
    <div className="screen">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 font-extrabold ink-drop">Wallet 💸</h1>
        <p className="text-small font-semibold text-muted">
          airdrop public USDC, then shield it into your private balance — one tap, no gas.
        </p>
      </div>

      {/* the rails + the flight overlay live in one relative stack so coins can
          visibly drop from the public rail into the vault. */}
      <div className="relative flex flex-col gap-3">
        <BalanceRail
          emoji="⚡"
          color="yellow"
          label="public · on-chain"
          sub="Arc testnet · visible to all"
          value={pubValue}
          loading={pub === "loading"}
          dim={flying}
        />

        <AirdropButton onAirdropped={refresh} />

        <ShieldAction
          publicUsdc={pubValue}
          onShieldStart={startFlight}
          onShielded={refresh}
        />

        <BalanceRail
          key={`vault-${shieldedValue ?? "x"}`}
          emoji="🔒"
          color="green"
          label="private vault · shielded"
          sub="Unlink · only you can see this"
          value={shieldedValue}
          loading={shielded === "loading"}
          hero
          className={flying ? "animate-pop" : ""}
        />

        {/* coin flight — spawned on shield, removed after ~1s */}
        {flying && (
          <div
            key={flyKey}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-16 flex justify-center"
          >
            <span className="shield-fly absolute text-3xl" style={{ ["--fly" as string]: "320px" }}>
              🪙
            </span>
            <span
              className="shield-fly absolute text-2xl"
              style={{ ["--fly" as string]: "300px", animationDelay: "0.08s", left: "42%" }}
            >
              💵
            </span>
            <span
              className="shield-fly absolute text-2xl"
              style={{ ["--fly" as string]: "330px", animationDelay: "0.16s", left: "56%" }}
            >
              🪙
            </span>
          </div>
        )}
      </div>

      <div className="text-tiny font-semibold text-muted text-center mt-1">
        public = a normal transparent USDC transfer · shielded = Unlink private balance
      </div>
    </div>
  );
}
