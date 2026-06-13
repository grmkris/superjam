// bridge router (§12) — called by the host shell on behalf of a sandboxed jam.
// appId arrives from the host's trusted Window→app map; identity is the
// session user. Every call validates the app (exists, not delisted) first.
import {
  AppId,
  ATTACH_MAX_MB,
  DmCardSchema,
  KEY_MAX_LEN,
  LIST_MAX,
  MSG_TEXT_MAX,
  RecordId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import {
  decodeBase64,
  sniffImageMime,
  storeAttachment,
} from "../lib/attachments.ts";
import { protectedProcedure } from "../orpc.ts";
import { createAiBridge } from "./bridge-ai.ts";
import { createChatService } from "../services/chat-service.ts";
import { createCounterService } from "../services/counter-service.ts";
import { createDataService } from "../services/data-service.ts";
import { createMessageService } from "../services/message-service.ts";
import { createStorageService } from "../services/storage-service.ts";
import { paymentsBridge } from "./payments.ts";
import { potBridge } from "./pot.ts";

const jsonRecord = z.record(z.string(), z.unknown());

const storage = {
  get: protectedProcedure
    .input(z.object({ appId: AppId, key: z.string().min(1).max(KEY_MAX_LEN) }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createStorageService({ db: context.db }).get(
        input.appId,
        context.user.id,
        input.key
      );
    }),

  getMany: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        keys: z.array(z.string().min(1).max(KEY_MAX_LEN)).max(LIST_MAX),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createStorageService({ db: context.db }).getMany(
        input.appId,
        context.user.id,
        input.keys
      );
    }),

  set: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        key: z.string().min(1).max(KEY_MAX_LEN),
        value: z.unknown(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      await createStorageService({ db: context.db }).set(
        input.appId,
        context.user.id,
        input.key,
        input.value
      );
      return { ok: true } as const;
    }),

  delete: protectedProcedure
    .input(z.object({ appId: AppId, key: z.string().min(1).max(KEY_MAX_LEN) }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      await createStorageService({ db: context.db }).delete(
        input.appId,
        context.user.id,
        input.key
      );
      return { ok: true } as const;
    }),

  clear: protectedProcedure
    .input(z.object({ appId: AppId }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      await createStorageService({ db: context.db }).clear(
        input.appId,
        context.user.id
      );
      return { ok: true } as const;
    }),

  list: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        prefix: z.string().max(KEY_MAX_LEN).optional(),
        limit: z.number().int().min(1).max(LIST_MAX).optional(),
        cursor: z.string().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createStorageService({ db: context.db }).list(
        input.appId,
        context.user.id,
        input
      );
    }),
};

const data = {
  insert: protectedProcedure
    .input(z.object({ appId: AppId, collection: z.string(), doc: jsonRecord }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createDataService({ db: context.db }).insert(
        input.appId,
        {
          id: context.user.id,
          username: context.user.username,
          worldVerified: context.user.worldVerified,
        },
        input.collection,
        input.doc
      );
    }),

  get: protectedProcedure
    .input(z.object({ appId: AppId, collection: z.string(), id: RecordId }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createDataService({ db: context.db }).get(
        input.appId,
        input.collection,
        input.id
      );
    }),

  update: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        collection: z.string(),
        id: RecordId,
        patch: jsonRecord,
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createDataService({ db: context.db }).update(
        input.appId,
        context.user.id,
        input.collection,
        input.id,
        input.patch
      );
    }),

  delete: protectedProcedure
    .input(z.object({ appId: AppId, collection: z.string(), id: RecordId }))
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      await createDataService({ db: context.db }).delete(
        input.appId,
        context.user.id,
        input.collection,
        input.id
      );
      return { ok: true } as const;
    }),

  list: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        collection: z.string(),
        where: jsonRecord.optional(),
        orderBy: z
          .object({ field: z.string(), dir: z.enum(["asc", "desc"]).optional() })
          .optional(),
        limit: z.number().int().min(1).max(LIST_MAX).optional(),
        cursor: z.string().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createDataService({ db: context.db }).list(
        input.appId,
        input.collection,
        input
      );
    }),
};

// Apps may not touch reserved platform counters (_plays, _ai_quota, …).
const assertAppCounter = (counter: string): void => {
  if (counter.startsWith("_")) {
    throw new ORPCError("BAD_REQUEST", { message: "Reserved counter name" });
  }
};

const counter = {
  increment: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        counter: z.string(),
        key: z.string(),
        by: z.number().int().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      assertAppCounter(input.counter);
      const value = await createCounterService({ db: context.db }).increment(
        input.appId,
        input.counter,
        input.key,
        input.by ?? 1
      );
      return { value };
    }),

  top: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        counter: z.string(),
        limit: z.number().int().min(1).max(LIST_MAX).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      assertAppCounter(input.counter);
      return createCounterService({ db: context.db }).top(
        input.appId,
        input.counter,
        input.limit ?? 10
      );
    }),
};

const messages = {
  send: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        to: z.string().min(1),
        text: z.string().min(1).max(MSG_TEXT_MAX),
        data: jsonRecord.optional(),
        link: z.string().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      return createMessageService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).send(
        input.appId,
        { id: context.user.id, username: context.user.username },
        input
      );
    }),

  list: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        limit: z.number().int().min(1).max(LIST_MAX).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      const rows = await createMessageService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).listForApp(input.appId, context.user.id, input.limit ?? 50);
      return { messages: rows };
    }),
};

// social.send (§3e) — a jam pushes a render-spec card + app-defined deeplink
// into a player's FRIEND's chat (friendship-gated in the service). Distinct from
// messages.send (one-way app→inbox); this writes the user↔user directMessage.
const social = {
  send: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        to: z.string().min(1),
        card: DmCardSchema,
        params: jsonRecord.optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const appRow = await requireApp(context.db, input.appId);
      return createChatService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      }).sendAppCard(
        input.appId,
        { id: context.user.id, username: context.user.username },
        {
          to: input.to,
          card: input.card,
          slug: appRow.slug,
          params: input.params,
        }
      );
    }),
};

// sdk.files.upload — a sandboxed jam uploads a blob (e.g. a canvas drawing for the
// AI judge). The SDK strips the data-URL prefix, so we sniff the image type from
// magic bytes. Returns { id: key, url: presigned-GET } — the url feeds sdk.ai.chat
// images or is shown to the user.
const files = {
  upload: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        dataBase64: z.string().min(1).max(Math.ceil(ATTACH_MAX_MB * 1024 * 1024 * 1.4)),
      })
    )
    .handler(async ({ context, input }) => {
      await requireApp(context.db, input.appId);
      const bytes = decodeBase64(input.dataBase64);
      const mime = sniffImageMime(bytes);
      if (!mime) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Unsupported upload — only PNG/JPEG/GIF/WebP images are accepted here.",
        });
      }
      const stored = await storeAttachment(context.objectStore, {
        owner: context.user.id,
        fileName: "upload",
        mime,
        bytes,
      });
      return { id: stored.key, url: stored.url };
    }),
};

// onchain games (§ builder-deploys-contracts) — a jam reads/writes its OWN
// Arc contract (the builder deployed it; address+abi live on the app row).
//   read  → a plain view call (no signing).
//   write → OPERATOR-relayed: the server wallet signs + pays Arc gas. We PIN the
//           target to the app's own contract (a jam can't make the operator key
//           sign against USDC/StakeSlash/anything else) and PREPEND the verified
//           player address as arg 0, so the contract's `fn(address player, …)`
//           is stamped server-side — the jam supplies only the trailing args.
const resolveGameContract = (
  appRow: Awaited<ReturnType<typeof requireApp>>
): { address: `0x${string}`; abi: readonly unknown[] } => {
  if (!appRow.gameContractAddress || !appRow.gameContractAbi) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This jam has no on-chain game contract",
    });
  }
  return {
    address: appRow.gameContractAddress as `0x${string}`,
    abi: appRow.gameContractAbi,
  };
};

// view results can contain bigint (uint returns), which JSON/oRPC can't carry —
// stringify deeply so the jam gets decimal strings it can BigInt() back.
const jsonSafe = (v: unknown): unknown =>
  typeof v === "bigint"
    ? v.toString()
    : Array.isArray(v)
      ? v.map(jsonSafe)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]))
        : v;

const onchain = {
  read: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        fn: z.string().min(1).max(64),
        args: z.array(z.unknown()).max(16).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const appRow = await requireApp(context.db, input.appId);
      const { address, abi } = resolveGameContract(appRow);
      const result = await context.onchain.game.read({
        address,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: abi as any,
        functionName: input.fn,
        args: input.args ?? [],
      });
      return jsonSafe(result);
    }),

  write: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        fn: z.string().min(1).max(64),
        args: z.array(z.unknown()).max(16).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const appRow = await requireApp(context.db, input.appId);
      const { address, abi } = resolveGameContract(appRow);
      if (!context.user.walletAddress) {
        throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
      }
      // Stamp the player as arg 0 — the jam never passes "who".
      const hash = await context.onchain.game.write({
        address,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: abi as any,
        functionName: input.fn,
        args: [context.user.walletAddress, ...(input.args ?? [])],
      });
      return { hash };
    }),
};

export const bridgeRouter = {
  storage,
  data,
  counter,
  messages,
  social,
  files,
  pot: potBridge,
  payments: paymentsBridge,
  ai: createAiBridge(),
  onchain,
};
