// Shared input validators for the bridge surface. safeParse already guards
// shapes at the router; these enforce the §7 size/name limits + the inbox-link
// rule (§9) and throw typed oRPC errors LLM-authored callers can read.
import { ORPCError } from "@orpc/server";
import {
  DEEPLINK_MAX_CHARS,
  KEY_REGEX,
  NAME_REGEX,
  SERVICE_URLS,
} from "@superjam/shared";

export const byteLength = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value ?? null), "utf8");

export const assertKey = (key: string): void => {
  if (!KEY_REGEX.test(key)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid key (must match ${KEY_REGEX.source})`,
    });
  }
};

export const assertName = (name: string): void => {
  if (!NAME_REGEX.test(name)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid name (must match ${NAME_REGEX.source})`,
    });
  }
};

export const assertSize = (value: unknown, maxBytes: number, what: string): void => {
  if (byteLength(value) > maxBytes) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${what} exceeds ${maxBytes} bytes serialized`,
    });
  }
};

const WEB_HOSTS = new Set(
  [SERVICE_URLS.local.web, SERVICE_URLS.dev.web, SERVICE_URLS.prod.web].map(
    (o) => new URL(o).host
  )
);

const LINK_RE = /^\/app\/([a-z0-9-]{3,32})(?:\?d=([^&]+))?$/;

/**
 * Validate + normalize an inbox `link` to a platform-origin relative path
 * `/app/<slug>[?d=…]` (§9). Accepts a full platform URL or a relative path;
 * rejects external hosts, extra query params, and oversized `d`.
 */
export const normalizeInboxLink = (link: string): string => {
  let path: string;
  if (link.startsWith("/")) {
    path = link;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid link URL" });
    }
    if (!WEB_HOSTS.has(parsed.host)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Link must point at the SuperJam web origin",
      });
    }
    path = parsed.pathname + parsed.search;
  }
  const m = LINK_RE.exec(path);
  if (!m) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Link must be /app/<slug>[?d=…]",
    });
  }
  const [, slug, d] = m;
  if (d && d.length > DEEPLINK_MAX_CHARS) {
    throw new ORPCError("BAD_REQUEST", { message: "Deeplink payload too large" });
  }
  return d ? `/app/${slug}?d=${d}` : `/app/${slug}`;
};
