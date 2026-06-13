// bridge router (§12) — called by the host shell on behalf of a sandboxed jam.
// appId arrives from the host's trusted Window→app map; identity is the
// session user. Every call validates the app (exists, not delisted) first.
import {
  AppId,
  KEY_MAX_LEN,
  LIST_MAX,
  MSG_TEXT_MAX,
  RecordId,
} from "@superjam/shared";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import { protectedProcedure } from "../orpc.ts";
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

export const bridgeRouter = {
  storage,
  data,
  counter,
  messages,
  pot: potBridge,
  payments: paymentsBridge,
};
