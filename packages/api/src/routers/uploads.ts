// uploads (§17) — host-facing attachment upload for the /build prompt. The user
// uploads images + docs (CSV/Excel/PDF); we store them and return a key (threaded
// into builds.refine/create) + a presigned GET URL (for preview). The build
// pipeline later re-presigns the key for the builder agent. Framed mini-apps use
// bridge.files.upload instead (same storeAttachment helper).
import { ATTACH_MAX_MB, BUILD_ATTACH_MAX } from "@superjam/shared";
import { z } from "zod";
import {
  ALLOWED_UPLOAD_MIME,
  decodeBase64,
  storeAttachment,
} from "../lib/attachments.ts";
import { protectedProcedure } from "../orpc.ts";

export const uploadsRouter = {
  // One file per call (the UI loops over the picked files, capped at
  // BUILD_ATTACH_MAX client-side). dataBase64 may include a data: prefix.
  create: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(200),
        mimeType: z.enum(
          Object.keys(ALLOWED_UPLOAD_MIME) as [string, ...string[]]
        ),
        dataBase64: z.string().min(1).max(Math.ceil(ATTACH_MAX_MB * 1024 * 1024 * 1.4)),
      })
    )
    .handler(async ({ context, input }) => {
      const bytes = decodeBase64(input.dataBase64);
      const stored = await storeAttachment(context.objectStore, {
        owner: context.user.id,
        fileName: input.fileName,
        mime: input.mimeType,
        bytes,
      });
      return { key: stored.key, url: stored.url, mime: stored.mime };
    }),
};

/** Re-exported so the UI/clients can mirror the server's cap. */
export const UPLOAD_LIMITS = { maxFiles: BUILD_ATTACH_MAX, maxMb: ATTACH_MAX_MB };
