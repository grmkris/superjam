// Crisp line icons for the primary nav (Make · Discover · Inbox). Replaces the
// childish teddy/lightning/envelope emoji with clean 24px stroke glyphs that
// inherit currentColor — so the active tab simply colours in. `filled` thickens
// the stroke + adds a soft fill for the active state.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { filled?: boolean };

const base = (filled?: boolean) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: filled ? 2.4 : 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

// Make — a four-point spark (create / generate).
export function MakeIcon({ filled, ...rest }: IconProps) {
  return (
    <svg {...base(filled)} {...rest}>
      <path
        d="M12 3c.4 3.6 1.9 5.1 5.5 5.5C13.9 8.9 12.4 10.4 12 14c-.4-3.6-1.9-5.1-5.5-5.5C10.1 8.1 11.6 6.6 12 3Z"
        fill={filled ? "currentColor" : "none"}
      />
      <path d="M18.5 14c.2 1.7.9 2.4 2.5 2.6-1.6.2-2.3.9-2.5 2.6-.2-1.7-.9-2.4-2.5-2.6 1.6-.2 2.3-.9 2.5-2.6Z" fill={filled ? "currentColor" : "none"} />
    </svg>
  );
}

// Discover — a compass (explore the feed).
export function DiscoverIcon({ filled, ...rest }: IconProps) {
  return (
    <svg {...base(filled)} {...rest}>
      <circle cx="12" cy="12" r="9" fill={filled ? "currentColor" : "none"} opacity={filled ? 0.12 : 1} />
      <circle cx="12" cy="12" r="9" />
      <path
        d="M15.6 8.4 13.9 13l-4.6 1.7L11 10.1l4.6-1.7Z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

// SparkMark — the SuperJam logo glyph (a confident four-point spark). Pink fill,
// ink outline, sits in front of the wordmark.
export function SparkMark({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...rest}
    >
      <path
        d="M12 2c.7 5.3 3 7.6 8.3 8.3C15 11 12.7 13.3 12 18.6 11.3 13.3 9 11 3.7 10.3 9 9.6 11.3 7.3 12 2Z"
        fill="var(--color-pink)"
        stroke="var(--color-ink)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Inbox — an envelope.
export function InboxIcon({ filled, ...rest }: IconProps) {
  return (
    <svg {...base(filled)} {...rest}>
      <rect x="3" y="5" width="18" height="14" rx="3" fill={filled ? "currentColor" : "none"} opacity={filled ? 0.12 : 1} />
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 5 8-5" />
    </svg>
  );
}
