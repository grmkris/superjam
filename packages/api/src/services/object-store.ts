// Object-store port (§17) — the API depends on this minimal interface; the server
// injects apps/server's BlobStore (Bun S3Client over the Railway bucket), which is
// structurally compatible. Keyless null default so boot/tests stay green without S3.
export interface ObjectStore {
  /** Whether S3 creds are present — routers should 503 clearly when false. */
  configured: boolean;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array | string, contentType: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** A time-limited public GET URL for `key` (handed to the builder agent). */
  presignGet(key: string, expiresInSec: number): string;
}

export class ObjectStoreNotConfiguredError extends Error {
  constructor() {
    super("Object storage is not configured (need S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY).");
    this.name = "ObjectStoreNotConfiguredError";
  }
}

/** The degraded store — reads empty, writes/presign reject. Default so a
 *  storage-less environment still boots/typechecks (same doctrine as nullOnchain). */
export const nullObjectStore: ObjectStore = {
  configured: false,
  get: () => Promise.resolve(null),
  put() {
    return Promise.reject(new ObjectStoreNotConfiguredError());
  },
  list: () => Promise.resolve([]),
  presignGet() {
    throw new ObjectStoreNotConfiguredError();
  },
};
