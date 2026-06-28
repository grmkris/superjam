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
// Migrated to the new headless SDK (@dynamic-labs-sdk/*): the JWT is read off the
// client (`dynamicClient.token`); wallet + auth state come from the SDK hooks.
import {
  useDynamicClient,
  useInitStatus,
  useUser,
  useWalletAccounts,
} from "@dynamic-labs-sdk/react-hooks";
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
  /** Resolve the viewer's Bearer token at request time — awaits Dynamic init so
   *  a protected call fired before the SDK is ready WAITS for the token instead
   *  of going out tokenless (which 401s). Returns null once init settles with no
   *  signed-in user. Stable across renders (safe as an oRPC `getToken`). */
  getToken: () => Promise<string | null>;
}

export function useHostAuth(): HostAuth {
  const client = useDynamicClient();
  const { data: initStatus } = useInitStatus();
  // useUser re-renders on login / logout / profile change — drives the effect.
  const { data: user } = useUser();
  const { data: walletAccounts } = useWalletAccounts();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [hostUser, setHostUser] = useState<HostUser | null>(null);
  const [meStatus, setMeStatus] = useState<MeStatus>("pending");

  const evmAddress =
    walletAccounts?.find((w) => w.chain === "EVM")?.address ?? null;

  // Live ref to the Dynamic client so the token resolver reads `client.token`
  // (a live getter) at request time rather than a stale React snapshot.
  const clientRef = useRef(client);
  clientRef.current = client;

  // One-time deferred that resolves once Dynamic init SETTLES (finished OR
  // failed — resolve on failed too so requests never hang). The token resolver
  // awaits this before reading the token, so calls fired pre-init wait instead
  // of going out without a Bearer header.
  const initSettled = useRef<{
    promise: Promise<void>;
    resolve: () => void;
  } | null>(null);
  if (!initSettled.current) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    initSettled.current = { promise, resolve };
  }
  useEffect(() => {
    if (initStatus === "finished" || initStatus === "failed") {
      initSettled.current?.resolve();
    }
  }, [initStatus]);

  const getToken = useCallback(async (): Promise<string | null> => {
    await initSettled.current?.promise;
    return clientRef.current?.token ?? null;
  }, []);

  useEffect(() => {
    // The client's JWT is only populated once init has finished and the user is
    // signed in; reading it earlier yields null. Re-run when the user changes.
    if (initStatus !== "finished") return;
    const token = client?.token ?? null;
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
  }, [initStatus, user, client]);

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
