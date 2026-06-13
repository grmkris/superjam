// Bridge protocol — the security boundary between host and sandboxed jam (§8).
// Hand-rolled (no penpal): zero unspecified library behavior with opaque
// origins. These zod schemas are the authoritative envelope contract; both the
// host bridge lib (apps/web) and the child SDK (@superjam/sdk) parse against
// them. ≈150 lines/side.
import { z } from "zod";

export const BRIDGE_VERSION = 1 as const;

// Flat method strings (§8). Kept as a zod enum so an unknown method is a
// BAD_REQUEST at parse time, never a silent dispatch.
export const BRIDGE_METHODS = [
  "host.hello",
  "app.context",
  "wallet.getAddress",
  "wallet.sendTransaction",
  "payments.payUSDC",
  "payments.usdcBalance",
  "payments.payX402",
  "payments.mine",
  "storage.get",
  "storage.getMany",
  "storage.set",
  "storage.delete",
  "storage.clear",
  "storage.list",
  "data.insert",
  "data.get",
  "data.update",
  "data.delete",
  "data.list",
  "counter.increment",
  "counter.top",
  "ai.chat",
  "pot.create",
  "pot.stake",
  "pot.get",
  "pot.resolve",
  "messages.send",
  "messages.list",
  "social.send",
  "share.link",
  "files.upload",
  "ui.toast",
  // identity: a short-lived platform-signed token the app's own backend
  // verifies against /.well-known/jwks.json (pivot §1).
  "auth.getToken",
  // stretch S1 realtime:
  "data.subscribe",
  "data.unsubscribe",
] as const;
export const BridgeMethod = z.enum(BRIDGE_METHODS);
export type BridgeMethod = z.infer<typeof BridgeMethod>;

export const TJ_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN_CAPABILITY",
  "QUOTA_EXCEEDED",
  "USER_REJECTED",
  "STANDALONE",
  "RATE_LIMITED",
  "BAD_REQUEST",
  "INTERNAL",
] as const;
export const TJErrorCode = z.enum(TJ_ERROR_CODES);
export type TJErrorCode = z.infer<typeof TJErrorCode>;

// nanoid request id — printable, bounded.
const RequestId = z.string().min(1).max(64);

// child → parent
export const TJRequestSchema = z.object({
  tj: z.literal(BRIDGE_VERSION),
  id: RequestId,
  method: BridgeMethod,
  params: z.unknown(),
});
export type TJRequest = z.infer<typeof TJRequestSchema>;

// parent → child (reply)
export const TJResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    tj: z.literal(BRIDGE_VERSION),
    id: RequestId,
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    tj: z.literal(BRIDGE_VERSION),
    id: RequestId,
    ok: z.literal(false),
    error: z.object({ code: TJErrorCode, message: z.string() }),
  }),
]);
export type TJResponse = z.infer<typeof TJResponseSchema>;

// parent → child (unsolicited, stretch S1 realtime)
export const TJEventSchema = z.object({
  tj: z.literal(BRIDGE_VERSION),
  event: z.literal("data.changed"),
  data: z.object({ collection: z.string() }),
});
export type TJEvent = z.infer<typeof TJEventSchema>;

// Helpers for constructing well-formed envelopes.
export const tjOk = (id: string, result: unknown): TJResponse => ({
  tj: BRIDGE_VERSION,
  id,
  ok: true,
  result,
});

export const tjErr = (
  id: string,
  code: TJErrorCode,
  message: string
): TJResponse => ({
  tj: BRIDGE_VERSION,
  id,
  ok: false,
  error: { code, message },
});
