"use client";

// ToyboxTabs — keyboard-navigable, ARIA-correct tab bar (base-ui Tabs) in two
// Toybox skins. `segmented` is the pill-in-a-track look (inbox, jam reviews);
// `plain` is free-standing sticker pills (the floating Discover filter row).
// Replaces the three raw-<button> tab bars. base-ui marks the active tab with
// `data-active`.
import { Tabs } from "@base-ui-components/react/tabs";
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function ToyboxTabs<T extends string>({
  value,
  onValueChange,
  options,
  variant = "segmented",
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: TabOption<T>[];
  variant?: "segmented" | "plain";
  className?: string;
}) {
  const segmented = variant === "segmented";
  return (
    <Tabs.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      render={<div className={cx("w-full", className)} />}
    >
      <Tabs.List
        className={cx(
          "flex items-center",
          segmented
            ? "gap-1 rounded-full border-2 border-ink bg-card p-1"
            : "gap-2"
        )}
      >
        {options.map((o) => (
          <Tabs.Tab
            key={o.value}
            value={o.value}
            className={cx(
              "focus-ring cursor-pointer rounded-full font-extrabold transition-colors",
              "data-[active]:bg-ink data-[active]:text-cream",
              segmented
                ? "flex-1 px-4 py-1.5 text-small text-muted hover:text-ink data-[active]:hover:text-cream"
                : "border-2 border-ink bg-card px-4 py-1.5 text-small text-ink shadow-sticker-sm sticker-press"
            )}
          >
            {o.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
