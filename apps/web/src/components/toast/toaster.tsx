"use client";

// A tiny host-level toast. The bridge's `ui.toast` (host-handlers.ts) and the
// jams' share feedback ("Link copied — share it! 🔗") render HERE, above the jam
// iframe on the host chrome — previously they only `console.info`'d, so the player
// saw nothing. A module-singleton store lets the non-React bridge handler push from
// anywhere; <Toaster/> (mounted once in ClientRoot) subscribes + renders the stack.
import { useSyncExternalStore } from "react";

interface Toast {
  id: number;
  message: string;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

const emit = (): void => {
  for (const l of listeners) l();
};

/** Show a host toast. Safe from anywhere (SSR/tests no-op — nothing subscribes). */
export function pushToast(message: string): void {
  const m = (message ?? "").trim();
  if (!m) return;
  const id = nextId++;
  toasts = [...toasts, { id, message: m.slice(0, 140) }];
  emit();
  if (typeof setTimeout === "function") {
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    }, 2800);
  }
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const getSnapshot = (): Toast[] => toasts;
const EMPTY: Toast[] = [];
const getServerSnapshot = (): Toast[] => EMPTY;

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (items.length === 0) return null;
  return (
    <div aria-live="polite" style={wrap}>
      <style>{KEYFRAMES}</style>
      {items.map((t) => (
        <div key={t.id} style={pill}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

const KEYFRAMES =
  "@keyframes tj-toast-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}";

const wrap: React.CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 22px)",
  transform: "translateX(-50%)",
  zIndex: 2147483000,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  pointerEvents: "none",
  width: "max-content",
  maxWidth: "min(92vw, 420px)",
};

const pill: React.CSSProperties = {
  pointerEvents: "auto",
  background: "var(--color-ink, #18151d)",
  color: "var(--color-cream, #fafaf8)",
  borderRadius: 999,
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: 'var(--font-display, ui-sans-serif), system-ui, sans-serif',
  letterSpacing: "-0.01em",
  boxShadow:
    "0 10px 28px -8px rgba(24,21,29,0.5), 0 2px 6px rgba(24,21,29,0.2)",
  textAlign: "center",
  animation: "tj-toast-in .26s cubic-bezier(0.23,1,0.32,1) both",
};
