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
  OnchainError,
  PUBLIC_CHAIN,
  USDC,
  formatUsdc,
  parseUsdc,
  usdc,
} from "@superjam/onchain";
import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { getAddress, type Hex, isAddressEqual } from "viem";
import { z } from "zod";
import { requireApp } from "../lib/app-context.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { protectedProcedure } from "../orpc.ts";
import { createCounterService } from "../services/counter-service.ts";

const { publishPayment, potStake, user } = schema;

const Hex0x = z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid hex");
const Uint = z.string().regex(/^\d+$/, "Expected a base-unit integer");

const TX_CAP = parseUsdc(TX_CAP_USDC);
const WELCOME_FAUCET = parseUsdc("2"); // §23 one-time shielded welcome grant

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
  // Turn a confirm-sheet recipient into an on-chain address for the host's relay
  // executor (DESIGN_BRIEF §3d). `to` is "appTreasury" (a tip — needs appId), a
  // "@username" (pay a friend), or an already-0x address. Pure DB lookups; the
  // resolved 0x is what the browser signs the EIP-3009 auth against.
  resolveRecipient: protectedProcedure
    .input(z.object({ to: z.string().min(1), appId: AppId.optional() }))
    .handler(async ({ context, input }) => {
      const raw = input.to.trim();

      // already an address
      if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
        return { address: getAddress(raw), displayName: undefined };
      }

      // pay a friend: @username
      if (raw.startsWith("@")) {
        const handle = raw.slice(1).toLowerCase();
        const u = await context.db.query.user.findFirst({
          columns: {
            walletAddress: true,
            username: true,
            ensName: true,
            unlinkAddress: true,
          },
          where: eq(user.username, handle),
        });
        if (!u) {
          throw new ORPCError("BAD_REQUEST", { message: `Unknown user @${handle}` });
        }
        if (!u.walletAddress) {
          throw new ORPCError("BAD_REQUEST", {
            message: `@${handle} has no wallet yet`,
          });
        }
        return {
          address: getAddress(u.walletAddress),
          displayName: u.ensName ?? `@${u.username}`,
          // present ⇒ this friend can receive a PRIVATE send (the default path).
          unlinkAddress: u.unlinkAddress ?? undefined,
        };
      }

      // pot stake → the escrow custodian (the agent server wallet). The host's
      // stakePot confirm (kind "stake") routes USDC here, then proves it via
      // bridge.pot.stake (verifyUsdcTransfer expectedTo = escrow). (Opus P seam.)
      if (raw === "potEscrow") {
        return {
          address: getAddress(context.onchain.serverAddress),
          displayName: "the pot",
        };
      }

      // tip to the app treasury (falls back to the owner's wallet)
      if (raw === "appTreasury") {
        if (!input.appId) {
          throw new ORPCError("BAD_REQUEST", { message: "Missing appId for a tip" });
        }
        const appRow = await requireApp(context.db, input.appId);
        let address = appRow.treasuryAddress;
        let displayName: string | undefined = appRow.ensName ?? undefined;
        if (!address) {
          const owner = await context.db.query.user.findFirst({
            columns: { walletAddress: true, username: true, ensName: true },
            where: eq(user.id, appRow.ownerUserId),
          });
          address = owner?.walletAddress ?? null;
          displayName =
            displayName ?? owner?.ensName ?? (owner ? `@${owner.username}` : undefined);
        }
        if (!address) {
          throw new ORPCError("BAD_REQUEST", {
            message: "This jam can't receive tips yet",
          });
        }
        return { address: getAddress(address), displayName };
      }

      throw new ORPCError("BAD_REQUEST", { message: "Unrecognized recipient" });
    }),

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

  /** The user's public-rail USDC balance — drives the confirm sheet's
   *  insufficient-balance state + the top-up prompt (§15.1). Returns null when
   *  onchain is unconfigured or unreadable (the UI shows "—", never an error). */
  balance: protectedProcedure.handler(async ({ context }) => {
    if (!context.user.walletAddress) return { publicUsdc: null };
    try {
      const bal = await context.onchain.usdcBalance(
        PUBLIC_CHAIN,
        context.user.walletAddress as `0x${string}`
      );
      return { publicUsdc: formatUsdc(bal) };
    } catch (err) {
      if (err instanceof OnchainError) return { publicUsdc: null };
      throw err;
    }
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

  // --- private rail (§23, Unlink) — the SHIELDED-DEFAULT wallet + the ONE send
  // primitive (chat-send + miniapp payUSDC + sub-cent tips all route here). ---

  /** Enable the caller's shielded balance: derive + register their Unlink account
   *  (server-executed via the delegated signer) and persist the address. Idempotent. */
  enablePrivacy: protectedProcedure.handler(async ({ context }) => {
    const { unlinkAddress } = await tryOnchain(() =>
      context.unlink.enable(context.user.id)
    );
    await context.db
      .update(user)
      .set({ unlinkAddress })
      .where(eq(user.id, context.user.id));
    return { unlinkAddress };
  }),

  /** No-toggle auto-provision — the web calls this once on login. Derives +
   *  registers the shielded account, persists the address, and (first time only)
   *  grants the 2-USDC welcome faucet so a new user can test instantly. Idempotent;
   *  the faucet is best-effort (never blocks provisioning). */
  ensurePrivacy: protectedProcedure.handler(async ({ context }) => {
    const { unlinkAddress } = await tryOnchain(() =>
      context.unlink.enable(context.user.id)
    );
    const set: { unlinkAddress: string; lastTopupAt?: Date } = { unlinkAddress };
    let welcomeFauceted = false;
    // Gate on lastTopupAt = "never funded" so the welcome grant is once-per-user.
    if (!context.user.lastTopupAt) {
      try {
        await context.unlink.faucet(unlinkAddress, WELCOME_FAUCET);
        set.lastTopupAt = new Date();
        welcomeFauceted = true;
      } catch (err) {
        context.logger.debug({ err: String(err) }, "welcome faucet skipped");
      }
    }
    await context.db.update(user).set(set).where(eq(user.id, context.user.id));
    return { unlinkAddress, welcomeFauceted };
  }),

  /** The caller's SHIELDED balance — the in-app wallet (private by default).
   *  Returns null when privacy isn't enabled/configured (UI shows "—"). */
  privateBalance: protectedProcedure.handler(async ({ context }) => {
    try {
      const bal = await context.unlink.balance(context.user.id);
      return { shieldedUsdc: formatUsdc(bal) };
    } catch (err) {
      if (err instanceof OnchainError) return { shieldedUsdc: null };
      throw err;
    }
  }),

  /** Fund the shielded balance: deposit native USDC (public→private). Amount is a
   *  decimal string ("1.00"); sub-cent ("0.001") is fine. */
  depositPrivate: protectedProcedure
    .input(z.object({ amount: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const amount = parseUsdc(input.amount);
      if (amount > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      const txHash = await tryOnchain(() =>
        context.unlink.deposit(context.user.id, amount)
      );
      return { txHash };
    }),

  /** THE send primitive: a private transfer (tip / pay-a-friend / miniapp payUSDC,
   *  sub-cent capable). `to` = a `@username` or a raw `unlink1…` address. */
  privateSend: protectedProcedure
    .input(z.object({ to: z.string().min(1), amount: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const amount = parseUsdc(input.amount);
      if (amount > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      const raw = input.to.trim();

      // resolve the recipient's shielded (unlink1…) address.
      let toUnlink: string;
      if (raw.startsWith("unlink1")) {
        toUnlink = raw;
      } else if (raw.startsWith("@")) {
        const handle = raw.slice(1).toLowerCase();
        const u = await context.db.query.user.findFirst({
          columns: { id: true, unlinkAddress: true, username: true },
          where: eq(user.username, handle),
        });
        if (!u) {
          throw new ORPCError("BAD_REQUEST", { message: `Unknown user @${handle}` });
        }
        if (u.unlinkAddress) {
          toUnlink = u.unlinkAddress;
        } else {
          // Auto-provision the recipient — only possible if THEY have delegated
          // (getUserSigner resolves); else a clean "hasn't enabled private payments".
          try {
            const enabled = await context.unlink.enable(u.id);
            await context.db
              .update(user)
              .set({ unlinkAddress: enabled.unlinkAddress })
              .where(eq(user.id, u.id));
            toUnlink = enabled.unlinkAddress;
          } catch {
            throw new ORPCError("BAD_REQUEST", {
              message: `@${handle} hasn't enabled private payments yet`,
            });
          }
        }
      } else {
        throw new ORPCError("BAD_REQUEST", { message: "Unrecognized recipient" });
      }

      const txHash = await tryOnchain(() =>
        context.unlink.transfer(context.user.id, toUnlink, amount)
      );
      return { txHash };
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
