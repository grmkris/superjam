// SuperJam naming. Users and jams are identified by a plain local `@username` /
// jam name — no on-chain ENS namespace anymore.

/** Block-explorer link for a tx hash / address (Base Sepolia rail). */
export const basescan = (idOrTx: string): string =>
  `https://basescan.org/search?q=${encodeURIComponent(idOrTx)}`;

/** Friendly label for a builder's coding model id — the roster differentiates by
 *  capability, and "Opus" reads as the premium tier next to "Sonnet". Unknown ids
 *  fall back to a Title-cased middle segment ("claude-haiku-4-5" → "Haiku"). */
export const modelLabel = (model: string | null | undefined): string | null => {
  if (!model) return null;
  if (/opus/i.test(model)) return "Opus";
  if (/sonnet/i.test(model)) return "Sonnet";
  if (/haiku/i.test(model)) return "Haiku";
  const seg = model.split("-")[1] ?? model;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
};

/** Short, friendly capability labels for builder cards (the raw caps are routing
 *  keys like "contracts:evm" / "hosting:vercel"). Returns a de-duped, ordered list. */
export const capLabels = (caps: readonly string[] | null | undefined): string[] => {
  if (!caps?.length) return [];
  const out: string[] = [];
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  for (const c of caps) {
    if (c.startsWith("contracts")) add("contracts");
    else if (c.startsWith("database")) add("database");
    else if (c === "ai") add("AI");
    else if (c === "frontend") add("apps");
    else if (c.startsWith("hosting")) add("hosting");
    else add(c);
  }
  return out;
};
