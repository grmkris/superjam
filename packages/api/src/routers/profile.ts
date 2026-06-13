// profile router (§12). `me` (M1) + `topup` (M6 — worldVerified, both rails,
// 1/day). Never leak dynamicUserId / worldNullifierHash to the client.
import { schema } from "@superjam/db";
import {
  TOPUP_USDC,
  TOPUP_PER_HUMAN_PER_DAY,
  RESERVED_LABELS,
} from "@superjam/shared";
import { PRIVATE_CHAIN, PUBLIC_CHAIN, parseUsdc } from "@superjam/onchain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { protectedProcedure, worldVerifiedProcedure } from "../orpc.ts";

const { user: userTable } = schema;
type User = typeof schema.user.$inferSelect;

const TOPUP_COOLDOWN_MS = (24 / TOPUP_PER_HUMAN_PER_DAY) * 60 * 60 * 1000;

// Handle rules (mirror the client check in apps/web welcome): 3–24 chars,
// a–z/0–9/-, no leading/trailing dash, not reserved. Server is the source of truth.
const RESERVED = new Set<string>(RESERVED_LABELS as readonly string[]);
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,22}[a-z0-9])?$/;
const formatIssue = (name: string): "invalid" | "reserved" | null =>
  !USERNAME_RE.test(name) ? "invalid" : RESERVED.has(name) ? "reserved" : null;

export const toMe = (user: User) => ({
  id: user.id,
  username: user.username,
  ensName: user.ensName,
  email: user.email,
  walletAddress: user.walletAddress,
  worldVerified: user.worldVerified,
  freeBuildsUsed: user.freeBuildsUsed,
  unlinkAddress: user.unlinkAddress,
  createdAt: user.createdAt,
});

export const profileRouter = {
  me: protectedProcedure.handler(({ context }) => toMe(context.user)),

  // Live availability for the welcome/claim screen — format + uniqueness
  // (excludes the caller's own current handle so re-confirming is "free").
  usernameAvailable: protectedProcedure
    .input(z.object({ username: z.string() }))
    .handler(async ({ context, input }) => {
      const name = input.username.trim().toLowerCase();
      const issue = formatIssue(name);
      if (issue) return { ok: false as const, reason: issue };
      const existing = await context.db.query.user.findFirst({
        where: eq(userTable.username, name),
      });
      if (existing && existing.id !== context.user.id) {
        return { ok: false as const, reason: "taken" as const };
      }
      return { ok: true as const };
    }),

  // Pick/change your handle. Username is auto-derived from email on first login;
  // this lets the user override it (welcome "claim", later editable from /me).
  // Best-effort ENS subname mint — never blocks the claim (onchain is null until §16).
  claimUsername: protectedProcedure
    .input(z.object({ username: z.string() }))
    .handler(async ({ context, input }) => {
      const name = input.username.trim().toLowerCase();
      if (formatIssue(name)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Use a–z, 0–9, – (3–24 chars)",
        });
      }
      const existing = await context.db.query.user.findFirst({
        where: eq(userTable.username, name),
      });
      if (existing && existing.id !== context.user.id) {
        throw new ORPCError("CONFLICT", { message: "That name's already taken" });
      }
      let ensName = context.user.ensName;
      if (context.user.walletAddress) {
        try {
          // ENSv2-native `<username>.superjam.eth` — the single naming path,
          // resolvable in standard ENS tooling. Flat namespace (shared with app
          // slugs); the DB stays source of truth and the mint is best-effort, so
          // a rare username==slug clash is last-writer-wins on-chain only.
          const minted = await context.onchain.mintV2Subname({
            slug: name,
            owner: context.user.walletAddress as `0x${string}`,
            records: { url: `https://superjam.fun/@${name}` },
          });
          ensName = minted.ensName;
        } catch (err) {
          context.logger.debug({ err: String(err) }, "ENS mint skipped (onchain off)");
        }
      }
      const [updated] = await context.db
        .update(userTable)
        .set({ username: name, ensName })
        .where(eq(userTable.id, context.user.id))
        .returning();
      return toMe(updated ?? context.user);
    }),

  // Demo top-up (§15.1 rung 4): the server wallet sends TOPUP_USDC Base Sepolia
  // USDC AND seeds the Arc private balance (Unlink faucet) — both rails, one
  // tap, World-gated, 1/day. The private leg is best-effort: if Unlink is down
  // the public rail still funds (the demo never dies, §15).
  topup: worldVerifiedProcedure.handler(async ({ context }) => {
    const u = context.user;
    if (
      u.lastTopupAt &&
      Date.now() - u.lastTopupAt.getTime() < TOPUP_COOLDOWN_MS
    ) {
      throw new ORPCError("QUOTA_EXCEEDED", {
        message: "You can top up once a day",
      });
    }
    if (!u.walletAddress) {
      throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
    }

    const amount = parseUsdc(TOPUP_USDC);
    const publicTxHash = await tryOnchain(() =>
      context.onchain.sendUsdc(
        PUBLIC_CHAIN,
        u.walletAddress as `0x${string}`,
        amount
      )
    );

    // Best-effort private seed — never blocks the public top-up.
    let privateSeeded = false;
    if (u.unlinkAddress) {
      try {
        await context.onchain.unlink.faucetPrivateTokens({
          toUnlinkAddress: u.unlinkAddress,
          amount,
        });
        privateSeeded = true;
      } catch (err) {
        context.logger.debug(
          { err: String(err) },
          "private top-up seed unavailable"
        );
      }
    }

    await context.db
      .update(userTable)
      .set({ lastTopupAt: new Date() })
      .where(eq(userTable.id, u.id));

    return {
      amountUsdc: TOPUP_USDC,
      publicTxHash,
      publicChain: PUBLIC_CHAIN,
      privateSeeded,
      privateChain: PRIVATE_CHAIN,
    };
  }),
};
