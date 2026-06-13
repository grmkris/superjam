// SuperJam naming (DESIGN_BRIEF §6 family-tree identity). Every user is
// `name.superjam.fun`; every jam hangs under its maker as
// `slug.maker.superjam.fun`. (The mockups show `.eth` as a placeholder — the
// live root is superjam.fun.)
export const ROOT = "superjam.fun";

export const userEns = (username: string): string => `${username}.${ROOT}`;

export const jamEns = (slug: string, ownerUsername: string): string =>
  `${slug}.${ownerUsername}.${ROOT}`;

/** Basescan link for an address/tx (DESIGN_BRIEF §3b — name tags ↗ to chain). */
export const basescan = (idOrTx: string): string =>
  `https://basescan.org/search?q=${encodeURIComponent(idOrTx)}`;
