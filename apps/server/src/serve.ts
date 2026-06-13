// Bundle serving (§17). GET /a/:slug/* streams S3 apps/<appId>/<buildId>/<path>
// with a small LRU; index.html is no-cache and bumps the _plays counter (one
// per viewer load, zero client work); assets are immutable. Apps-origin CSP +
// path-traversal guard included. icon.svg renders the manifest emoji.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";
import { PLAYS_COUNTER } from "@superjam/shared";
import type { Logger } from "@superjam/logger";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { BlobStore } from "./bucket.ts";
import { createCounterService } from "@superjam/api";

const { app } = schema;

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
};
const mimeFor = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
};

// Apps-origin hardening (§8/§17): external files only, no inline script.
const APPS_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors *";

const createLru = (max: number) => {
  const map = new Map<string, Uint8Array>();
  return {
    get(key: string): Uint8Array | undefined {
      const v = map.get(key);
      if (v) {
        map.delete(key);
        map.set(key, v); // bump to MRU
      }
      return v;
    },
    set(key: string, value: Uint8Array): void {
      map.set(key, value);
      if (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest) {
          map.delete(oldest);
        }
      }
    },
  };
};

const iconSvg = (emoji: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="22" fill="#FFF4E3"/><text x="64" y="64" font-size="76" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;

const dayKey = (): string => new Date().toISOString().slice(0, 10);

export interface ServeDeps {
  db: Database;
  store: BlobStore;
  logger: Logger;
}

export const registerServeRoutes = (hono: Hono, deps: ServeDeps): void => {
  const { db, store, logger } = deps;
  const lru = createLru(50);
  const counters = createCounterService({ db });

  const findApp = (slug: string) =>
    db.query.app.findFirst({ where: eq(app.slug, slug) });

  hono.get("/a/:slug/icon.svg", async (c) => {
    const row = await findApp(c.req.param("slug"));
    if (!row) {
      return c.text("not found", 404);
    }
    return new Response(iconSvg(row.iconEmoji), {
      headers: {
        "content-type": "image/svg+xml",
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=86400",
      },
    });
  });

  const serve = async (c: Context, slug: string, rawPath: string) => {
    // path-traversal guard: no parent refs, no absolute paths.
    const rel = decodeURIComponent(rawPath).replace(/^\/+/, "") || "index.html";
    if (rel.includes("..") || rel.includes("\0")) {
      return c.text("bad path", 400);
    }
    const row = await findApp(slug);
    if (!row?.bundleKey) {
      return c.text("not found", 404);
    }
    const key = `${row.bundleKey}/${rel}`;
    const isIndex = rel === "index.html";

    let bytes = lru.get(key);
    if (!bytes) {
      const fetched = await store.get(key);
      if (!fetched) {
        return c.text("not found", 404);
      }
      bytes = fetched;
      if (!isIndex) {
        lru.set(key, bytes); // index.html is no-cache; don't LRU it
      }
    }

    if (isIndex) {
      // One play per viewer load (index.html is no-cache). Two cheap indexed
      // upserts; run sequentially (one db connection) and don't fail the serve.
      try {
        await counters.increment(row.id, PLAYS_COUNTER, "total");
        await counters.increment(row.id, PLAYS_COUNTER, dayKey());
      } catch (e) {
        logger.warn({ err: String(e) }, "plays bump failed");
      }
    }

    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": mimeFor(rel),
        "content-security-policy": APPS_CSP,
        "x-content-type-options": "nosniff",
        "cache-control": isIndex
          ? "no-cache, no-store, must-revalidate"
          : "public, max-age=31536000, immutable",
      },
    });
  };

  hono.get("/a/:slug", (c) => serve(c, c.req.param("slug"), "index.html"));
  hono.get("/a/:slug/*", (c) => {
    const slug = c.req.param("slug");
    const rest = c.req.path.slice(`/a/${slug}/`.length);
    return serve(c, slug, rest);
  });
};
