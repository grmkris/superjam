"use client";

// ToyboxSheet — the one bottom-sheet primitive. Built on vaul (Drawer): real
// drag-to-dismiss + spring, dressed in Toybox chrome (cream panel, 2px ink top
// edge, grab handle, safe-area bottom pad). Replaces the hand-rolled `fixed
// inset-0` sheets (confirm / pay / pickers / verify). A Title is required for
// a11y — pass `titleHidden` to keep it screen-reader-only when the sheet shows
// its own visual header.
import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { cx } from "./cx";

export function ToyboxSheet({
  open,
  onOpenChange,
  title,
  titleHidden = true,
  /** when false, drag / scrim / Esc can't dismiss (e.g. a tx mid-flight) */
  dismissible = true,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  titleHidden?: boolean;
  dismissible?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible={dismissible}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Drawer.Content
          aria-describedby={undefined}
          className={cx(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[460px] flex-col gap-4 overflow-y-auto",
            "rounded-t-toy-lg border-t-2 border-ink bg-cream px-5 pt-3 outline-none",
            "pb-[calc(2rem+env(safe-area-inset-bottom))]",
            className
          )}
        >
          {/* grab handle — the drag affordance */}
          <div aria-hidden className="mx-auto h-1.5 w-10 shrink-0 rounded-full bg-ink/15" />
          <Drawer.Title className={titleHidden ? "sr-only" : "text-h3 font-extrabold"}>
            {title}
          </Drawer.Title>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
