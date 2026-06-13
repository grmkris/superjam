// publish.submit (§12/§15) — the pay-to-publish flip. The owner pays the 1 USDC
// fee to the treasury on the public rail; we verify the Transfer LOG (so a
// gasless EIP-3009 fee, outer from=relayer, still proves the OWNER paid, §12),
// guard replays via the unique txHash, and list the app. Requires worldVerified.
import { schema } from "@superjam/db";
import { AppId, PUBLISH_FEE_USDC } from "@superjam/shared";
import { PUBLIC_CHAIN, USDC, parseUsdc } from "@superjam/onchain";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { type Hex, isAddressEqual } from "viem";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import { isUniqueViolation } from "../lib/db-errors.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { worldVerifiedProcedure } from "../orpc.ts";

const { app, publishPayment } = schema;
const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash");

export const publishRouter = {
  submit: worldVerifiedProcedure
    .input(z.object({ appId: AppId, txHash: TxHash }))
    .handler(async ({ context, input }) => {
      const row = await requireApp(context.db, input.appId);
      if (row.ownerUserId !== context.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not your app" });
      }
      if (!context.treasuryAddress) {
        throw new ORPCError("INTERNAL", { message: "Treasury not configured" });
      }
      if (!context.user.walletAddress) {
        throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
      }

      const { from } = await tryOnchain(() =>
        context.onchain.verifyUsdcTransfer({
          hash: input.txHash as Hex,
          chain: PUBLIC_CHAIN,
          expectedTo: context.treasuryAddress!,
          minAmount: parseUsdc(PUBLISH_FEE_USDC),
        })
      );
      // §12: the fee must come from the OWNER's wallet (Transfer-log from).
      if (!isAddressEqual(from, context.user.walletAddress as `0x${string}`)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Fee must be paid from your wallet",
        });
      }

      try {
        await context.db.insert(publishPayment).values({
          appId: input.appId,
          userId: context.user.id,
          txHash: input.txHash,
          chainId: USDC[PUBLIC_CHAIN].chainId,
          amountUsdc: PUBLISH_FEE_USDC,
          status: "confirmed",
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ORPCError("CONFLICT", {
            message: "This payment was already used",
          });
        }
        throw err;
      }

      await context.db
        .update(app)
        .set({ status: "listed" })
        .where(eq(app.id, input.appId));
      return { status: "listed" as const };
    }),
};
