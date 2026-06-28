"use client";

// ConfirmProvider — mounts the single ConfirmSheet over the whole app and wires
// it both ways: product flows call useConfirm().confirm(intent); %67's
// host-handlers call requestConfirm(intent) (registered here). Lives inside
// <Providers> in the root layout so it can reach the Dynamic wallet + typed
// client when the real relay path lands.
import { TX_CAP_USDC } from "@superjam/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type ConfirmIntent,
  type ConfirmResult,
  OverCapError,
  registerConfirm,
} from "./confirm-controller";
import { ConfirmSheet, type ConfirmPhase } from "./confirm-sheet";

const CAP = Number(TX_CAP_USDC);

export type PayExecutor = (
  intent: ConfirmIntent
) => Promise<{ txHash: string | null; paymentToken?: string }>;

interface ConfirmCtx {
  /** open the sheet and resolve when the user decides. Rejects (OverCapError)
   *  synchronously if the amount is over the single-tx cap. */
  confirm: (intent: ConfirmIntent) => Promise<ConfirmResult>;
}

const Ctx = createContext<ConfirmCtx | null>(null);

export const useConfirm = (): ConfirmCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return c;
};

interface Active {
  intent: ConfirmIntent;
  phase: ConfirmPhase;
  txHash?: string | null;
  error?: string;
}

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : "Something went wrong. Nothing was sent.";

// Default executor: SIMULATED — used only when no `executor` prop is supplied
// (tests / Storybook). In the app the REAL executor (useRelayExecutor in
// confirm/pay-executor.ts: EIP-3009 sign → payments.relay → real tx hash) is
// injected by ClientRoot's <WiredConfirm>, which sits inside <Providers> so the
// Dynamic wallet + typed client are reachable.
const simulate: PayExecutor = async (intent) => {
  await new Promise((r) => setTimeout(r, 1300));
  const seed = `${intent.to}${intent.amountUsdc}${Date.now()}`;
  let h = "";
  for (let i = 0; i < 64; i += 1) {
    h += "0123456789abcdef"[(seed.charCodeAt(i % seed.length) + i) % 16];
  }
  return { txHash: `0x${h}` };
};

export function ConfirmProvider({
  children,
  executor = simulate,
}: {
  children: ReactNode;
  executor?: PayExecutor;
}) {
  const [active, setActive] = useState<Active | null>(null);
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);

  const settle = useCallback((result: ConfirmResult) => {
    resolver.current?.(result);
    resolver.current = null;
    setActive(null);
  }, []);

  const confirm = useCallback((intent: ConfirmIntent): Promise<ConfirmResult> => {
    if (intent.amountUsdc > CAP) {
      return Promise.reject(new OverCapError(CAP));
    }
    if (resolver.current) {
      return Promise.reject(new Error("Another confirmation is in progress"));
    }
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
      setActive({ intent, phase: "review" });
    });
  }, []);

  // Expose to non-React callers (%67 host-handlers).
  useEffect(() => {
    registerConfirm(confirm);
    return () => registerConfirm(null);
  }, [confirm]);

  const approve = useCallback(async () => {
    setActive((a) => (a ? { ...a, phase: "pending" } : a));
    const intent = active?.intent;
    if (!intent) return;
    try {
      const { txHash } = await executor(intent);
      setActive((a) => (a ? { ...a, phase: "success", txHash } : a));
      setTimeout(() => settle({ approved: true, txHash }), 1300);
    } catch (e) {
      setActive((a) => (a ? { ...a, phase: "error", error: errText(e) } : a));
    }
  }, [active, executor, settle]);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {active && (
        <ConfirmSheet
          intent={active.intent}
          phase={active.phase}
          txHash={active.txHash}
          error={active.error}
          onApprove={approve}
          onReject={() => settle({ approved: false })}
        />
      )}
    </Ctx.Provider>
  );
}
