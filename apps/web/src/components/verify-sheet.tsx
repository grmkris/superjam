"use client";

// VerifySheet — a host bottom-sheet (mirrors confirm-sheet.tsx) that hosts the
// WorldGate so the "verify you're human" flow can pop from ANYWHERE (the profile
// card, a publish CTA, etc.) instead of only living inline in the build/review
// pages. Drive it with local `open` state + an `onVerified` callback.
import { WorldGate } from "./world-gate";

export function VerifySheet({
  open,
  onClose,
  onVerified,
  title,
  blurb,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
  title?: string;
  blurb?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Dismiss"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="relative w-full max-w-[460px] bg-cream border-t-2 border-ink rounded-t-toy-lg px-5 pt-3 pb-6 animate-[slideup_.18s_ease-out]">
        <div className="flex justify-end">
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted text-2xl leading-none px-2 -mt-1"
          >
            ×
          </button>
        </div>
        <WorldGate
          onVerified={() => {
            onVerified();
            onClose();
          }}
          title={title}
          blurb={blurb}
        />
        <style>{`@keyframes slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      </div>
    </div>
  );
}
