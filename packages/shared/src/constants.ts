// Platform-wide limits + identifiers (§7). Single source of truth; routers,
// the bridge, and the SDK all read from here.

// --- storage / data quotas ---
export const STORAGE_MAX_KEYS = 1000; // KV keys per (user, app)
export const STORAGE_VALUE_MAX_BYTES = 64 * 1024; // serialized value cap
export const RECORDS_MAX_PER_APP = 10_000; // shared-collection docs per app
export const DOC_MAX_BYTES = 64 * 1024; // serialized doc cap

// --- naming ---
export const NAME_REGEX = /^[A-Za-z0-9_-]{1,64}$/; // collection/counter names
export const KEY_REGEX = /^[A-Za-z0-9_-]{1,128}$/; // storage/counter keys
export const SLUG_REGEX = /^[a-z0-9-]{3,32}$/; // app slugs + usernames
export const COLLECTION_MAX_LEN = 64;
export const COUNTER_MAX_LEN = 64;
export const KEY_MAX_LEN = 128;

// Usernames + flat appslugs share one namespace with real DNS subdomains of
// superjam.fun — reject these (checked at username claim AND slug dedupe, §11).
export const RESERVED_LABELS = [
  "www",
  "dev",
  "apps",
  "apps-dev",
  "builder",
  "gateway",
  "mail",
] as const;

// --- builds / trial ---
export const FREE_BUILDS = 1;
export const BUILD_ATTACH_MAX = 4; // user file attachments per make
export const ATTACH_MAX_MB = 2; // per attachment

// --- payments (USDC, decimal strings) ---
export const PUBLISH_FEE_USDC = "1";
export const TX_CAP_USDC = "25"; // host-side hard cap per single tx
export const TOPUP_USDC = "5";
export const TOPUP_PER_HUMAN_PER_DAY = 1;
export const AGENT_PRICE_MAX_USDC = "5";
export const POT_STAKE_MAX_USDC = "10";
export const POT_TOTAL_MAX_USDC = "100";
export const X402_MAX_USDC = "2";

// --- AI (in-app sdk.ai + refine) ---
export const AI_CALLS_PER_USER_APP_DAY = 25;
export const AI_MAX_OUTPUT_TOKENS = 1000;
export const AI_APP_MODEL = "claude-haiku-4-5";
export const REFINE_CALLS_PER_USER_DAY = 20;
export const X402_CALLS_PER_USER_APP_DAY = 10;

// --- discovery ---
export const LIST_MAX = 100;
export const SIMILAR_MAX = 3;
export const CATEGORIES = [
  "game",
  "social",
  "tool",
  "creative",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// --- reviews ---
export const REVIEW_TEXT_MAX = 280;

// --- messages / inbox ---
export const MSG_TEXT_MAX = 280;
export const MSG_DATA_MAX_BYTES = 1024;
export const INBOX_CAP = 200; // evict oldest READ first
export const MSG_PER_PAIR_PER_MIN = 5;
export const MSG_PER_SENDER_PER_MIN = 20;

// --- deeplinks (?d=) ---
export const DEEPLINK_JSON_MAX_BYTES = 2 * 1024; // 2KiB JSON before base64url
export const DEEPLINK_MAX_CHARS = 2730; // base64url of a 2KiB payload

// --- bridge ---
export const BRIDGE_RATE_LIMIT_PER_SEC = 20; // calls/s per (app, user)
export const BRIDGE_HELLO_TIMEOUT_MS = 5000; // no reply ⇒ standalone mode

// --- reserved counter names (reuse app_counter, §7) ---
export const PLAYS_COUNTER = "_plays";
export const AI_QUOTA_COUNTER = "_ai_quota";
export const X402_QUOTA_COUNTER = "_x402_quota";
export const RESERVED_COUNTERS = [
  PLAYS_COUNTER,
  AI_QUOTA_COUNTER,
  X402_QUOTA_COUNTER,
] as const;
