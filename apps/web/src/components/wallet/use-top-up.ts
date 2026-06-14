"use client";

// The ONE top-up (§23) — used by the /me WalletCard and the confirm-sheet
// insufficient-balance state. Drops test USDC from the server wallet → the user's
// public wallet (faucetPublic), then shields it into the private balance
// (depositPrivate) — coins land straight in the in-app vault. Fixed $5, one tap.
// Server-wallet-sourced (no shielded faucet pool). Swap faucetPublic for a real
// onramp later; callers don't change.
import { useCallback, useState } from "react";
import { usePlatformClient } from "../use-platform-client";

export const AIRDROP_USDC = "5";

export function useTopUp() {
  const client = usePlatformClient();
  const [busy, setBusy] = useState<null | "drop" | "shield">(null);
  const [error, setError] = useState<string | null>(null);

  /** Airdrop + shield. Resolves true on success, false on failure (sets `error`). */
  const topUp = useCallback(async (): Promise<boolean> => {
    setBusy("drop");
    setError(null);
    try {
      await client.payments.faucetPublic({ amount: AIRDROP_USDC });
      setBusy("shield");
      await client.payments.depositPrivate({ amount: AIRDROP_USDC });
      return true;
    } catch {
      setError("Airdrop failed — try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }, [client]);

  return { topUp, busy, error };
}
