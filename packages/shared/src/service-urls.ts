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

// Testnet-only event posture (§15.1); mainnet = a post-event config flip.
// The single money chain is Arc testnet (§15); identity (ENS + ERC-8004) is Sepolia L1.
export const chainForEnv = () => "arcTestnet" as const;
