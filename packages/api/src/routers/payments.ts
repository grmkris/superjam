// payments (§12/§13/§15). `relay` is the gasless public-rail transport: the user
// signs an EIP-3009 authorization (buildTransferAuth) and we submit it, pay the
// ETH, and return the REAL tx hash — the caller then proves it via publish.submit
// / pot.stake. `mine` is the user's public-rail ledger. `payX402` (bridge,
// gated cherry §14) pays an x402 resource privately through Unlink+Gateway.
import { schema } from "@superjam/db";
import {
  AppId,
  TX_CAP_USDC,
  X402_MAX_USDC,
  X402_QUOTA_COUNTER,
  X402_CALLS_PER_USER_APP_DAY,
} from "@superjam/shared";
import {
  PUBLIC_CHAIN,
  USDC,
  parseUsdc,
  usdc,
} from "@superjam/onchain";
import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { type Hex, isAddressEqual } from "viem";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { protectedProcedure } from "../orpc.ts";
import { createCounterService } from "../services/counter-service.ts";

const { publishPayment, potStake } = schema;

const Hex0x = z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid hex");
const Uint = z.string().regex(/^\d+$/, "Expected a base-unit integer");

const TX_CAP = parseUsdc(TX_CAP_USDC);

// The EIP-3009 authorization, wire form: bigints as decimal-integer strings.
const AuthorizationInput = z.object({
  from: Hex0x,
  to: Hex0x,
  value: Uint, // USDC base units (6-dec)
  validAfter: Uint, // unix seconds
  validBefore: Uint, // unix seconds
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export const paymentsRouter = {
  /** Relay a user-signed EIP-3009 transfer on the public rail (§13). */
  relay: protectedProcedure
    .input(
      z.object({
        chain: z.literal("baseSepolia").default("baseSepolia"),
        authorization: AuthorizationInput,
        signature: Hex0x,
      })
    )
    .handler(async ({ context, input }) => {
      const { authorization: a } = input;
      if (!context.user.walletAddress) {
        throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
      }
      // You may only relay an authorization signed by your own wallet.
      if (!isAddressEqual(a.from as `0x${string}`, context.user.walletAddress as `0x${string}`)) {
        throw new ORPCError("FORBIDDEN", {
          message: "Authorization is not from your wallet",
        });
      }
      const value = usdc(BigInt(a.value));
      if (value > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      if (BigInt(a.validBefore) <= nowSec) {
        throw new ORPCError("BAD_REQUEST", { message: "Authorization expired" });
      }

      const txHash = await tryOnchain(() =>
        context.onchain.relayTransfer({
          chain: PUBLIC_CHAIN,
          authorization: {
            from: a.from as `0x${string}`,
            to: a.to as `0x${string}`,
            value,
            validAfter: BigInt(a.validAfter),
            validBefore: BigInt(a.validBefore),
            nonce: a.nonce as Hex,
          },
          signature: input.signature as Hex,
        })
      );
      return { txHash };
    }),

  /** The caller's public-rail activity: publish fees paid + pot stakes (§12). */
  mine: protectedProcedure.handler(async ({ context }) => {
    const [publishes, stakes] = [
      await context.db
        .select()
        .from(publishPayment)
        .where(eq(publishPayment.userId, context.user.id))
        .orderBy(desc(publishPayment.createdAt)),
      await context.db
        .select()
        .from(potStake)
        .where(eq(potStake.userId, context.user.id))
        .orderBy(desc(potStake.createdAt)),
    ];
    return {
      publishes: publishes.map((p) => ({
        appId: p.appId,
        txHash: p.txHash,
        amountUsdc: p.amountUsdc,
        chainId: p.chainId,
        status: p.status,
        createdAt: p.createdAt,
      })),
      stakes: stakes.map((s) => ({
        potId: s.potId,
        option: s.option,
        amountUsdc: s.amountUsdc,
        txHash: s.txHash,
        paidOut: s.paidOutTxHash !== null,
        createdAt: s.createdAt,
      })),
    };
  }),
};

// bridge.payments — host-called, capability "payments" (§12). payX402 is a
// gated, cut-first cherry: guard rails (cap + per-user/app/day quota) then the
// Unlink+Gateway leg. Unconfigured ⇒ PAYMENT_REQUIRED (the rest of payments is
// unaffected).
export const paymentsBridge = {
  payX402: protectedProcedure
    .input(
      z.object({
        appId: AppId,
        url: z.string().url(),
        amountUsdc: z.string().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      const app = await requireApp(context.db, input.appId);
      if (!app.capabilities.includes("payments")) {
        throw new ORPCError("FORBIDDEN", {
          message: "App lacks the payments capability",
        });
      }
      const amount = parseUsdc(input.amountUsdc);
      if (amount > parseUsdc(X402_MAX_USDC)) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the x402 cap" });
      }

      // Per-(user, app, day) quota on the reserved counter (§7) — no parallel
      // quota system.
      const day = new Date().toISOString().slice(0, 10);
      const used = await createCounterService({ db: context.db }).increment(
        input.appId,
        X402_QUOTA_COUNTER,
        `${context.user.id}:${day}`,
        1
      );
      if (used > X402_CALLS_PER_USER_APP_DAY) {
        throw new ORPCError("QUOTA_EXCEEDED", {
          message: "Daily x402 limit reached",
        });
      }
      if (!context.user.unlinkAddress) {
        throw new ORPCError("PAYMENT_REQUIRED", {
          message: "Private payments not provisioned",
        });
      }

      const { hash } = await tryOnchain(() =>
        context.onchain.unlink.payX402({
          fromUnlinkAddress: context.user.unlinkAddress!,
          url: input.url,
          amount,
        })
      );
      return { txHash: hash };
    }),
};

// Surface the chain id for callers that record receipts.
export const PUBLIC_CHAIN_ID = USDC[PUBLIC_CHAIN].chainId;
