// NameTag — the ENS "name-tag" sticker (DESIGN_BRIEF §5). A punched-hole tag:
// a colored hole on the left, mono ENS text, a small ↗ to Basescan. NOT a plain
// chip. States: minted (solid hole) · pending (dashed hole, muted) · absent.
import { cx } from "./ui/cx";

export type NameTagState = "minted" | "pending" | "absent";

const HOLE_COLOR: Record<Exclude<NameTagState, "absent">, string> = {
  minted: "bg-yellow border-ink",
  pending: "bg-card border-muted border-dashed",
};

export function NameTag({
  name,
  state = "minted",
  href,
  className,
}: {
  /** full ENS name, e.g. "tipjar.kris.superjam.fun" */
  name: string;
  state?: NameTagState;
  /** Basescan record link — renders the ↗ when present */
  href?: string;
  className?: string;
}) {
  if (state === "absent") return null;
  // split label.rest so the owner suffix reads muted
  const dot = name.indexOf(".");
  const label = dot > 0 ? name.slice(0, dot) : name;
  const rest = dot > 0 ? name.slice(dot) : "";

  const body = (
    <span
      className={cx(
        // tag shape: punched hole on the left, rounded on the right
        "inline-flex items-center gap-1.5 border-2 border-ink bg-card",
        "rounded-l-md rounded-r-full pl-2 pr-2.5 py-1 max-w-full",
        state === "pending" && "opacity-70",
        className
      )}
    >
      <span
        className={cx(
          "w-[7px] h-[7px] rounded-full border-[1.5px] shrink-0",
          HOLE_COLOR[state]
        )}
      />
      <span className="font-mono text-tiny font-bold truncate">
        {label}
        {rest && <span className="text-muted font-medium">{rest}</span>}
      </span>
      {state === "pending" && (
        <span className="text-[9px] font-extrabold text-muted">pending…</span>
      )}
      {href && state === "minted" && (
        <span className="text-[10px] font-extrabold text-blue shrink-0">↗</span>
      )}
    </span>
  );

  if (href && state === "minted") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full no-underline"
      >
        {body}
      </a>
    );
  }
  return body;
}
