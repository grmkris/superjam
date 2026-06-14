"use client";

// useHostAuth (pivot §1 login seam) — the single source the host shell uses to
// know WHO the viewer is and HOW to authenticate to the platform:
//   authToken  the viewer's Dynamic JWT (Bearer for protected oRPC, incl.
//              auth.mintAppToken so framed apps get identity tokens)
//   hostUser   the platform user (profile.me) → fed to AppFrame's app.context
//   getAddress the Dynamic embedded-wallet address (wired into the bridge so a
//              mini-app's wallet.getAddress resolves)
// Opus P's product UI also reads {isLoggedIn} to render login/profile chrome.
//
// Dynamic React SDK (@dynamic-labs/sdk-react-core): the JWT comes from
// getAuthToken(); user/wallet/load state from useDynamicContext().
import { getAuthToken, useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostUser } from "../components/app-frame";
import { browserRpcUrl, createPlatformClient } from "./orpc";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** Where the `profile.me` fetch is: `pending` (unknown — don't yet treat the
 *  viewer as unverified), `ready` (hostUser is authoritative), `error` (fetch
 *  failed; hostUser is null but that's NOT a verified=false signal). Gate
 *  deciders must wait for `ready` before routing someone to the World gate. */
export type MeStatus = "pending" | "ready" | "error";

export interface HostAuth {
  authToken: string | null;
  hostUser: HostUser | null;
  isLoggedIn: boolean;
  meStatus: MeStatus;
  getAddress: () => Promise<string>;
  /** Resolve the viewer's Bearer token at request time — awaits Dynamic load so
   *  a protected call fired before the SDK is ready WAITS for the token instead
   *  of going out tokenless (which 401s). Returns null once load settles with no
   *  signed-in user. Stable across renders (safe as an oRPC `getToken`). */
  getToken: () => Promise<string | null>;
}

export function useHostAuth(): HostAuth {
  // useDynamicContext re-renders on login / logout / wallet change.
  const { user, primaryWallet, sdkHasLoaded } = useDynamicContext();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [hostUser, setHostUser] = useState<HostUser | null>(null);
  const [meStatus, setMeStatus] = useState<MeStatus>("pending");

  const evmAddress = primaryWallet?.address ?? null;

  // One-time deferred that resolves once the SDK has loaded. The token resolver
  // awaits this before reading the token, so calls fired pre-load wait instead of
  // going out without a Bearer header.
  const loaded = useRef<{ promise: Promise<void>; resolve: () => void } | null>(
    null
  );
  if (!loaded.current) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    loaded.current = { promise, resolve };
  }
  useEffect(() => {
    if (sdkHasLoaded) loaded.current?.resolve();
  }, [sdkHasLoaded]);

  const getToken = useCallback(async (): Promise<string | null> => {
    await loaded.current?.promise;
    return getAuthToken() ?? null;
  }, []);

  useEffect(() => {
    // The JWT is only populated once the SDK has loaded and the user is signed
    // in; reading it earlier yields undefined. Re-run when the user changes.
    if (!sdkHasLoaded) return;
    const token = getAuthToken() ?? null;
    setAuthToken(token);
    if (!token) {
      // Resolved: nobody is signed in (hostUser null is authoritative, not a
      // pending/error state — the login chrome, not the World gate, applies).
      setHostUser(null);
      setMeStatus("ready");
      return;
    }
    let cancelled = false;
    setMeStatus("pending");
    const platform = createPlatformClient({
      url: browserRpcUrl(),
      getToken: () => token,
    });
    platform.profile
      .me()
      .then((me) => {
        if (cancelled) return;
        setHostUser({
          id: me.id,
          username: me.username,
          walletAddress: me.walletAddress ?? ZERO_ADDR,
          worldVerified: me.worldVerified,
        });
        setMeStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setHostUser(null);
        setMeStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sdkHasLoaded, user, primaryWallet]);

  const getAddress = useCallback(async (): Promise<string> => {
    if (!evmAddress) throw new Error("No wallet connected");
    return evmAddress;
  }, [evmAddress]);

  return {
    authToken,
    hostUser,
    isLoggedIn: Boolean(authToken),
    meStatus,
    getAddress,
    getToken,
  };
}
