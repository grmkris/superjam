// Blob store (§17): bundles + uploaded files live in S3 (Railway/Tigris/MinIO),
// never on the builder — every published jam keeps working if the dev box dies.
// A small interface so the serve handler is DI-testable with an in-memory store.
import { S3Client } from "bun";
import type { ServerEnv } from "@superjam/shared/env";

export interface BlobStore {
  configured: boolean;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array | string, contentType: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** A time-limited public GET URL for `key` — handed to the builder agent so it
   *  can fetch user attachments off the box. Throws if the store isn't configured. */
  presignGet(key: string, expiresInSec: number): string;
}

export const createS3Store = (env: ServerEnv): BlobStore => {
  const configured = Boolean(
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
  );
  let client: S3Client | null = null;
  const getClient = (): S3Client | null => {
    if (!configured) {
      return null;
    }
    client ??= new S3Client({
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
    });
    return client;
  };

  return {
    configured,
    async get(key) {
      const c = getClient();
      if (!c) {
        return null;
      }
      try {
        return new Uint8Array(await c.file(key).arrayBuffer());
      } catch {
        return null;
      }
    },
    async put(key, data, contentType) {
      const c = getClient();
      if (!c) {
        throw new Error("bucket not configured");
      }
      await c.write(key, data, { type: contentType });
    },
    async list(prefix) {
      const c = getClient();
      if (!c) {
        return [];
      }
      const res = await c.list({ prefix, maxKeys: 1000 });
      return (res.contents ?? []).map((o) => o.key);
    },
    presignGet(key, expiresInSec) {
      const c = getClient();
      if (!c) {
        throw new Error("bucket not configured");
      }
      return c.presign(key, { method: "GET", expiresIn: expiresInSec });
    },
  };
};

const toBytes = (d: Uint8Array | string): Uint8Array =>
  typeof d === "string" ? new TextEncoder().encode(d) : d;

/** In-memory store for tests + local dev without MinIO. */
export const createMemoryStore = (): BlobStore => {
  const map = new Map<string, Uint8Array>();
  return {
    configured: true,
    get: (key) => Promise.resolve(map.get(key) ?? null),
    put: (key, data) => {
      map.set(key, toBytes(data));
      return Promise.resolve();
    },
    list: (prefix) =>
      Promise.resolve([...map.keys()].filter((k) => k.startsWith(prefix))),
    presignGet: (key) => `memory://${key}`,
  };
};
