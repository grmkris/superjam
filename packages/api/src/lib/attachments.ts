// Attachment storage (§17) — shared by the host-facing `uploads.create` (build
// prompt) and the framed-app `bridge.files.upload` (sdk.files.upload). Validates
// size + type, writes to the object store under a per-owner key, and hands back a
// presigned GET URL. The model/builder reads files by URL (presigned) or the
// platform resolves bytes by key (objectStore.get).
import { ATTACH_MAX_MB } from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import type { ObjectStore } from "../services/object-store.ts";

const MAX_BYTES = ATTACH_MAX_MB * 1024 * 1024;
/** Presigned GET lifetime for an uploaded attachment (1h — covers a build run). */
export const ATTACHMENT_URL_TTL_SEC = 60 * 60;

/** Allowed upload MIME types (images for vision + the doc formats the builder reads). */
export const ALLOWED_UPLOAD_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export const isImageMime = (mime: string): boolean => mime.startsWith("image/");

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
/** Image-ness inferred from the stored key's extension (storeAttachment appends it). */
export const isImageKey = (key: string): boolean =>
  IMAGE_EXTS.has(extOf(key));

/** The key's lowercased extension (storeAttachment appends `.<ext>`). */
export const extOf = (key: string): string => key.split(".").pop()?.toLowerCase() ?? "";

/** The original filename portion of a stored key (`attachments/<u>/<uuid>/<name>.<ext>`). */
export const nameOf = (key: string): string => key.split("/").pop() ?? key;

// Ext → MIME for the types Gemini can read as a content part (image vision + native
// PDF + text). `.xlsx` (binary spreadsheet) isn't readable inline → omitted (null).
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
};
/** The MIME Gemini can ingest for this key's type, or null if not model-readable. */
export const modelMimeOf = (key: string): string | null => EXT_MIME[extOf(key)] ?? null;

/** Presign GET URLs for a set of keys (skips silently if the store is unconfigured). */
export const presignAll = (
  store: ObjectStore,
  keys: readonly string[],
  ttlSec = ATTACHMENT_URL_TTL_SEC
): string[] => (store.configured ? keys.map((k) => store.presignGet(k, ttlSec)) : []);

/** Decode base64 (tolerating a `data:...;base64,` prefix) to bytes. */
export const decodeBase64 = (b64: string): Uint8Array => {
  const comma = b64.indexOf(",");
  const raw = b64.startsWith("data:") && comma !== -1 ? b64.slice(comma + 1) : b64;
  return new Uint8Array(Buffer.from(raw, "base64"));
};

/** Sniff an image MIME from magic bytes (the SDK strips the data-URL prefix). */
export const sniffImageMime = (bytes: Uint8Array): string | null => {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png"; // \x89PNG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg"; // JPEG SOI
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif"; // GIF
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  )
    return "image/webp"; // RIFF (webp)
  return null;
};

const safeName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";

export interface StoredAttachment {
  key: string;
  url: string;
  mime: string;
}

/** Validate + store one attachment; returns its key + a presigned GET URL. */
export const storeAttachment = async (
  store: ObjectStore,
  args: { owner: string; fileName: string; mime: string; bytes: Uint8Array }
): Promise<StoredAttachment> => {
  if (!store.configured) {
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "File storage is not available." });
  }
  if (args.bytes.length === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "Empty file." });
  }
  if (args.bytes.length > MAX_BYTES) {
    throw new ORPCError("BAD_REQUEST", {
      message: `File too large — max ${ATTACH_MAX_MB}MB.`,
    });
  }
  if (!ALLOWED_UPLOAD_MIME[args.mime]) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Unsupported file type: ${args.mime}.`,
    });
  }
  const ext = ALLOWED_UPLOAD_MIME[args.mime];
  const key = `attachments/${args.owner}/${crypto.randomUUID()}/${safeName(args.fileName)}.${ext}`;
  await store.put(key, args.bytes, args.mime);
  return { key, url: store.presignGet(key, ATTACHMENT_URL_TTL_SEC), mime: args.mime };
};
