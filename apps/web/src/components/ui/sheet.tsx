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
        {/* z above the fullscreen jam stage (z-[100]) so sheets opened from
            inside a running jam (share / app menu) aren't hidden behind it. */}
        <Drawer.Overlay className="fixed inset-0 z-[190] bg-ink/40 lg:bg-ink/55" />
        <Drawer.Content
          aria-describedby={undefined}
          className={cx(
            // mobile: full-width bottom sheet that slides up (unchanged).
            "fixed inset-x-0 bottom-0 z-[200] mx-auto flex max-h-[92dvh] w-full max-w-[460px] flex-col gap-4 overflow-y-auto",
            "rounded-t-toy-lg border-t-[1.5px] border-ink bg-cream px-5 pt-3 outline-none",
            "pb-[calc(2rem+env(safe-area-inset-bottom))]",
            // desktop (lg): lift off the bottom and float as a Toybox dialog
            // card — full ink frame, all corners rounded, sane max-width. A
            // fixed top offset (not translate) keeps vaul's own slide transform
            // free to animate the entrance.
            "lg:inset-x-0 lg:bottom-auto lg:top-[7dvh] lg:max-h-[86dvh] lg:max-w-[520px]",
            "lg:rounded-toy-lg lg:border-[1.5px] lg:px-6 lg:pt-4 lg:pb-6 lg:shadow-sticker-lg",
            className
          )}
        >
          {/* grab handle — mobile drag affordance; hidden on the desktop dialog */}
          <div aria-hidden className="mx-auto h-1.5 w-10 shrink-0 rounded-full bg-ink/15 lg:hidden" />
          <Drawer.Title className={titleHidden ? "sr-only" : "text-h3 font-extrabold"}>
            {title}
          </Drawer.Title>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
