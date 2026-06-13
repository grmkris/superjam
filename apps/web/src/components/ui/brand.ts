// SuperJam naming. ENSv2-native, flat: every user is `name.superjam.eth` and
// every jam is `slug.superjam.eth` — one resolvable namespace under superjam.eth
// (resolves in standard ENS tooling: viem/ethers/app.ens.domains).
export const ROOT = "superjam.eth";

export const userEns = (username: string): string => `${username}.${ROOT}`;

export const jamEns = (slug: string): string => `${slug}.${ROOT}`;

/** ENS-app link for a name — names resolve in standard tooling, so the name tag
 *  ↗ goes to the ENS manager (Sepolia), not a block explorer. */
export const ensApp = (name: string): string =>
  `https://sepolia.app.ens.domains/${encodeURIComponent(name)}`;

/** Block-explorer link for a tx hash / address (Base Sepolia rail). */
export const basescan = (idOrTx: string): string =>
  `https://basescan.org/search?q=${encodeURIComponent(idOrTx)}`;
