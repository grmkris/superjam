// SuperJam naming. Users and jams are identified by a plain local `@username` /
// jam name — no on-chain ENS namespace anymore.

/** Block-explorer link for a tx hash / address (Base Sepolia rail). */
export const basescan = (idOrTx: string): string =>
  `https://basescan.org/search?q=${encodeURIComponent(idOrTx)}`;
