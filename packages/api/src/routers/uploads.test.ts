import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";

setDefaultTimeout(20_000);
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import {
  decodeBase64,
  sniffImageMime,
  storeAttachment,
} from "../lib/attachments.ts";
import type { ObjectStore } from "../services/object-store.ts";
import { createTestApp, createTestUser } from "../testing/factories.ts";
import { bridgeRouter } from "./bridge.ts";
import { uploadsRouter } from "./uploads.ts";

const logger = createLogger({ level: "silent" });

// 1×1 PNG (valid magic bytes), base64 (no data: prefix).
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const memStore = (): ObjectStore => {
  const map = new Map<string, Uint8Array>();
  return {
    configured: true,
    get: (k) => Promise.resolve(map.get(k) ?? null),
    put: (k, d) => {
      map.set(k, typeof d === "string" ? new TextEncoder().encode(d) : d);
      return Promise.resolve();
    },
    list: (p) => Promise.resolve([...map.keys()].filter((k) => k.startsWith(p))),
    presignGet: (k) => `https://blob.test/${k}`,
  };
};

const harness = async (objectStore: ObjectStore) => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const owner = await createTestUser(db);
  const app = await createTestApp(db, owner.id, { status: "listed" });
  const token = await auth.sign({ dynamicUserId: "dyn_up", email: "up@test.io" });
  const ctx = () =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter: createRateLimiter(),
      objectStore,
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
  return { ctx, appId: app.id };
};

describe("attachment helpers", () => {
  test("sniffs a PNG from magic bytes", () => {
    expect(sniffImageMime(decodeBase64(PNG_B64))).toBe("image/png");
  });
  test("rejects an unsupported mime", async () => {
    await expect(
      storeAttachment(memStore(), {
        owner: "u1",
        fileName: "x.exe",
        mime: "application/x-msdownload",
        bytes: new Uint8Array([1, 2, 3]),
      })
    ).rejects.toThrow(/Unsupported file type/);
  });
  test("503s when the store isn't configured", async () => {
    const off: ObjectStore = { ...memStore(), configured: false };
    await expect(
      storeAttachment(off, { owner: "u", fileName: "a.png", mime: "image/png", bytes: new Uint8Array([1]) })
    ).rejects.toThrow();
  });
});

describe("uploads.create (host)", () => {
  test("stores a CSV and returns a key + url", async () => {
    const { ctx } = await harness(memStore());
    const res = await call(
      uploadsRouter.create,
      {
        fileName: "data.csv",
        mimeType: "text/csv",
        dataBase64: Buffer.from("a,b\n1,2").toString("base64"),
      },
      { context: ctx() }
    );
    expect(res.key).toMatch(/^attachments\/.+\/data\.csv\.csv$/);
    expect(res.url).toContain("https://blob.test/");
  });
});

describe("bridge.files.upload (framed app)", () => {
  test("sniffs + stores an image, returns { id, url }", async () => {
    const { ctx, appId } = await harness(memStore());
    const res = await call(
      bridgeRouter.files.upload,
      { appId, dataBase64: PNG_B64 },
      { context: ctx() }
    );
    expect(res.id).toContain("attachments/");
    expect(res.url).toContain("https://blob.test/");
  });

  test("rejects a non-image blob", async () => {
    const { ctx, appId } = await harness(memStore());
    await expect(
      call(
        bridgeRouter.files.upload,
        { appId, dataBase64: Buffer.from("not an image").toString("base64") },
        { context: ctx() }
      )
    ).rejects.toThrow(ORPCError);
  });
});
