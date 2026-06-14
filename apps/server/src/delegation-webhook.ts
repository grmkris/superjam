// Dynamic delegation webhook (§23) — receives `wallet.delegation.created` /
// `.revoked`, decrypts the per-user MPC share with our delegation private key, and
// persists it so the server can sign AS the user (private payments). Mounted as a
// raw Hono route (POST /api/webhooks/dynamic/delegation), gateway-routed to the
// server (Caddy: /api/* -> server).
import { createHmac, timingSafeEqual } from "node:crypto";
import { type Database, schema } from "@superjam/db";
import type { Logger } from "@superjam/logger";
import type { UserId } from "@superjam/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { EncryptedDelegatedPayload } from "@dynamic-labs-wallet/node";
import { type DelegationCreds, decryptDelegation } from "./delegated-signer.ts";

const { user, userDelegation } = schema;

/** Load a user's stored delegation creds for the UnlinkService `getUserSigner`. */
export const loadDelegationCreds = async (
  db: Database,
  userId: string
): Promise<DelegationCreds | null> => {
  const row = await db.query.userDelegation.findFirst({
    where: eq(userDelegation.userId, userId as UserId),
  });
  if (!row) return null;
  return {
    walletId: row.walletId,
    address: row.address as `0x${string}`,
    walletApiKey: row.walletApiKey,
    keyShare: row.keyShare as DelegationCreds["keyShare"],
  };
};

/** Best-effort HMAC-SHA256 verification of the raw body against the webhook secret.
 *  The exact header is confirmed from the first live event (logged on mismatch). */
const verifySignature = (
  rawBody: string,
  secret: string,
  headers: Headers
): boolean => {
  const provided =
    headers.get("x-dynamic-signature-256") ??
    headers.get("x-dynamic-signature") ??
    headers.get("x-signature") ??
    "";
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided.replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
};

export interface DelegationWebhookDeps {
  db: Database;
  logger: Logger;
  /** RSA PEM that decrypts the delegated share (DYNAMIC_DELEGATION_PRIVATE_KEY). */
  privateKeyPem: string;
  /** Webhook signing secret (DYNAMIC_WEBHOOK_SECRET). */
  webhookSecret: string;
}

export const registerDelegationWebhook = (
  app: Hono,
  deps: DelegationWebhookDeps
): void => {
  app.post("/api/webhooks/dynamic/delegation", async (c) => {
    const raw = await c.req.text();
    if (!verifySignature(raw, deps.webhookSecret, c.req.raw.headers)) {
      // Log the header names (NOT values) once so we can confirm the scheme live.
      deps.logger.warn(
        { headers: [...c.req.raw.headers.keys()] },
        "delegation webhook: signature mismatch/absent",
      );
      return c.json({ error: "invalid signature" }, 401);
    }

    let evt: {
      eventName?: string;
      data?: {
        userId?: string;
        walletId?: string;
        // `publicKey` IS the embedded wallet's EVM address (per Dynamic's webhook
        // payload), not a raw secp256k1 key — usable directly as walletAddress.
        publicKey?: string;
        encryptedDelegatedShare?: EncryptedDelegatedPayload;
        encryptedWalletApiKey?: EncryptedDelegatedPayload;
      };
    };
    try {
      evt = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad json" }, 400);
    }
    const d = evt.data ?? {};

    if (evt.eventName === "wallet.delegation.created") {
      if (!d.userId || !d.walletId || !d.encryptedDelegatedShare || !d.encryptedWalletApiKey) {
        return c.json({ error: "missing delegation fields" }, 400);
      }
      const u = await deps.db.query.user.findFirst({
        where: eq(user.dynamicUserId, d.userId),
      });
      if (!u) {
        // 200 so Dynamic doesn't retry forever; the user must have signed in once.
        deps.logger.warn({ dynamicUserId: d.userId }, "delegation for unknown user");
        return c.json({ ok: true, skipped: "unknown user" });
      }
      // Self-provision walletAddress from the payload when login didn't set it (the
      // dev JWT omits verified_credentials, so auth/verifier.ts can't extract it).
      // `data.publicKey` is the wallet's EVM address. This is what faucetPublic +
      // the private rail key off, so granting delegation also fills it in.
      const address = (u.walletAddress ?? d.publicKey) as `0x${string}` | undefined;
      if (!address) {
        deps.logger.warn({ dynamicUserId: d.userId }, "delegation without resolvable address");
        return c.json({ ok: true, skipped: "no address" });
      }
      if (!u.walletAddress) {
        await deps.db
          .update(user)
          .set({ walletAddress: address })
          .where(eq(user.id, u.id));
      }
      const { decryptedDelegatedShare, decryptedWalletApiKey } = decryptDelegation({
        privateKeyPem: deps.privateKeyPem,
        encryptedDelegatedKeyShare: d.encryptedDelegatedShare,
        encryptedWalletApiKey: d.encryptedWalletApiKey,
      });
      const values = {
        userId: u.id,
        dynamicUserId: d.userId,
        walletId: d.walletId,
        address,
        walletApiKey: decryptedWalletApiKey,
        keyShare: decryptedDelegatedShare as unknown as object,
      };
      await deps.db
        .insert(userDelegation)
        .values(values)
        .onConflictDoUpdate({ target: userDelegation.userId, set: values });
      deps.logger.info({ userId: u.id }, "delegation stored");
      return c.json({ ok: true });
    }

    if (evt.eventName === "wallet.delegation.revoked") {
      if (d.userId) {
        await deps.db
          .delete(userDelegation)
          .where(eq(userDelegation.dynamicUserId, d.userId));
        deps.logger.info({ dynamicUserId: d.userId }, "delegation revoked");
      }
      return c.json({ ok: true });
    }

    // wallet.delegation.signature + anything else: ack, no-op.
    return c.json({ ok: true });
  });
};
