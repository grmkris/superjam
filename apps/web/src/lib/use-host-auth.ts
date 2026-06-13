"use client";

// useHostAuth (pivot §1 login seam) — the single source the host shell uses to
// know WHO the viewer is and HOW to authenticate to the platform:
//   authToken  the viewer's Dynamic JWT (Bearer for protected oRPC, incl.
//              auth.mintAppToken so framed apps get identity tokens)
//   hostUser   the platform user (profile.me) → fed to AppFrame's app.context
//   getAddress the Dynamic embedded-wallet address (wired into the bridge so a
//              mini-app's wallet.getAddress resolves)
// Opus P's product UI also reads {isLoggedIn} to render login/profile chrome.
import { getAuthToken, useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useCallback, useEffect, useState } from "react";
import type { HostUser } from "../components/app-frame";
import { browserRpcUrl, createPlatformClient } from "./orpc";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export interface HostAuth {
  authToken: string | null;
  hostUser: HostUser | null;
  isLoggedIn: boolean;
  getAddress: () => Promise<string>;
}

export function useHostAuth(): HostAuth {
  const { primaryWallet, sdkHasLoaded } = useDynamicContext();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [hostUser, setHostUser] = useState<HostUser | null>(null);

  useEffect(() => {
    const token = getAuthToken() ?? null;
    setAuthToken(token);
    if (!token) {
      setHostUser(null);
      return;
    }
    let cancelled = false;
    const client = createPlatformClient({
      url: browserRpcUrl(),
      getToken: () => token,
    });
    client.profile
      .me()
      .then((me) => {
        if (cancelled) return;
        setHostUser({
          id: me.id,
          username: me.username,
          walletAddress: me.walletAddress ?? ZERO_ADDR,
          worldVerified: me.worldVerified,
        });
      })
      .catch(() => {
        if (!cancelled) setHostUser(null);
      });
    return () => {
      cancelled = true;
    };
    // sdkHasLoaded + primaryWallet change on login/logout/wallet-switch.
  }, [sdkHasLoaded, primaryWallet]);

  const getAddress = useCallback(async (): Promise<string> => {
    const addr = primaryWallet?.address;
    if (!addr) throw new Error("No wallet connected");
    return addr;
  }, [primaryWallet]);

  return {
    authToken,
    hostUser,
    isLoggedIn: Boolean(authToken),
    getAddress,
  };
}
