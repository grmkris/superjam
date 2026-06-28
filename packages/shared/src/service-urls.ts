// Single APP_ENV → per-environment service URLs (§5). House pattern.
export const ENVIRONMENTS = ["local", "dev", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export type ServiceUrls = {
  web: string;
  apiInternal: string;
  appsOrigin: string;
  cookieDomain: string;
  builder: string;
};

export const SERVICE_URLS: Record<Environment, ServiceUrls> = {
  local: {
    web: "http://localhost:4700",
    apiInternal: "http://localhost:4701",
    appsOrigin: "http://localhost:4701",
    cookieDomain: "localhost",
    builder: "http://localhost:4710",
  },
  dev: {
    web: "https://dev.superjam.fun",
    apiInternal: "http://server.railway.internal:4701",
    appsOrigin: "https://apps-dev.superjam.fun",
    cookieDomain: "dev.superjam.fun",
    builder: "https://builder.superjam.fun",
  },
  prod: {
    web: "https://superjam.fun",
    apiInternal: "http://server.railway.internal:4701",
    appsOrigin: "https://apps.superjam.fun",
    cookieDomain: "superjam.fun",
    builder: "https://builder.superjam.fun",
  },
};

export const urlsForEnv = (env: Environment): ServiceUrls => SERVICE_URLS[env];

// Money chain: defaults to Base Sepolia (testnet) everywhere; flip to real-money
// Base mainnet with MONEY_CHAIN=baseMainnet. Identity (ENS + ERC-8004) stays on
// Sepolia L1. Mirrors PUBLIC_CHAIN in @superjam/onchain (kept in sync; returns the
// bare key for callers that can't import the onchain package).
export const chainForEnv = (): "baseMainnet" | "baseSepolia" =>
  (process.env.MONEY_CHAIN ?? process.env.NEXT_PUBLIC_MONEY_CHAIN) === "baseMainnet"
    ? "baseMainnet"
    : "baseSepolia";
