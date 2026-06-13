"use client";

// VerifySheet — a host bottom-sheet (mirrors confirm-sheet.tsx) that hosts the
// WorldGate so the "verify you're human" flow can pop from ANYWHERE (the profile
// card, a publish CTA, etc.) instead of only living inline in the build/review
// pages. Drive it with local `open` state + an `onVerified` callback.
import { ToyboxSheet } from "./ui/sheet";
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
  return (
    <ToyboxSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title ?? "Verify you're human"}
    >
      <WorldGate
        onVerified={() => {
          onVerified();
          onClose();
        }}
        title={title}
        blurb={blurb}
      />
    </ToyboxSheet>
  );
}
