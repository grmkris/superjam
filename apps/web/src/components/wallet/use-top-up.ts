"use client";

// Get testnet USDC — drops a fixed amount of public testnet USDC into the user's
// own wallet via payments.faucetPublic. Used by the /me WalletCard. One tap.
import { useCallback, useState } from "react";
import { usePlatformClient } from "../use-platform-client";

export const AIRDROP_USDC = "5";

export function useTopUp() {
  const client = usePlatformClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Drop testnet USDC into the wallet. Resolves true on success, false on failure. */
  const topUp = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await client.payments.faucetPublic({ amount: AIRDROP_USDC });
      return true;
    } catch {
      setError("Couldn't get testnet USDC — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [client]);

  return { topUp, busy, error };
}
