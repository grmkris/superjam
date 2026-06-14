"use client";

// The ONE top-up (§23) — used by the /me WalletCard and the confirm-sheet
// insufficient-balance state. Funds the user's SHIELDED balance directly from the
// platform pool (addFunds → unlink.faucet) — coins land straight in the in-app
// private vault, no public-wallet leg and no walletAddress needed. Requires the
// private rail to be provisioned first (EnablePrivacy's one-time signature). Fixed
// $5, one tap. Swap the pool faucet for a real onramp later; callers don't change.
import { useCallback, useState } from "react";
import { usePlatformClient } from "../use-platform-client";

export const AIRDROP_USDC = "5";

export function useTopUp() {
  const client = usePlatformClient();
  const [busy, setBusy] = useState<null | "drop" | "shield">(null);
  const [error, setError] = useState<string | null>(null);

  /** Airdrop into the shielded balance. Resolves true on success, false on failure. */
  const topUp = useCallback(async (): Promise<boolean> => {
    setBusy("drop");
    setError(null);
    try {
      await client.payments.addFunds({
        sourceChain: "arcTestnet",
        amount: AIRDROP_USDC,
      });
      return true;
    } catch {
      setError("Airdrop failed — enable private payments first.");
      return false;
    } finally {
      setBusy(null);
    }
  }, [client]);

  return { topUp, busy, error };
}
