// profile router (§12). `me` (M1) + `topup` (M6 — worldVerified, both rails,
// 1/day). Never leak dynamicUserId / worldNullifierHash to the client.
import { schema } from "@superjam/db";
import { TOPUP_USDC, TOPUP_PER_HUMAN_PER_DAY } from "@superjam/shared";
import { PRIVATE_CHAIN, PUBLIC_CHAIN, parseUsdc } from "@superjam/onchain";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { protectedProcedure, worldVerifiedProcedure } from "../orpc.ts";

const { user: userTable } = schema;
type User = typeof schema.user.$inferSelect;

const TOPUP_COOLDOWN_MS = (24 / TOPUP_PER_HUMAN_PER_DAY) * 60 * 60 * 1000;

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
