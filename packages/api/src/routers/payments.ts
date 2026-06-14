// payments (§12/§13/§15). `relay` is the gasless public-rail transport: the user
// signs an EIP-3009 authorization (buildTransferAuth) and we submit it, pay the
// ETH, and return the REAL tx hash — the caller then proves it via publish.submit
// / pot.stake. `mine` is the user's public-rail ledger. `payX402` (bridge,
// gated cherry §14) pays an x402 resource privately through Unlink+Gateway.
import { schema } from "@superjam/db";
import {
  AppId,
  TX_CAP_USDC,
  type UserId,
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
import { createChatService } from "../services/chat-service.ts";
import { createCounterService } from "../services/counter-service.ts";

const { publishPayment, potStake, user, userDelegation } = schema;

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
        chain: z.literal(PUBLIC_CHAIN).default(PUBLIC_CHAIN),
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

  /** Demo airdrop: drop public Arc USDC into the caller's OWN wallet so they can
   *  then visibly shield it (the /wallet showcase). Public-only, Arc-only — the
   *  server wallet ERC-20 transfers from its Arc balance. TX_CAP is the only
   *  guard (no World gate / daily limit; this is a testnet faucet). */
  faucetPublic: protectedProcedure
    .input(z.object({ amount: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      if (!context.user.walletAddress) {
        throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
      }
      const amount = parseUsdc(input.amount);
      if (amount > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      const txHash = await tryOnchain(() =>
        context.onchain.sendUsdc(
          PUBLIC_CHAIN,
          context.user.walletAddress as `0x${string}`,
          amount
        )
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

  /** Bootstrap the private rail from a BROWSER signature (no Dynamic delegation):
   *  the embedded wallet signed CANON_UNLINK_MESSAGE once; we persist that signature
   *  so the server can replay it to derive + operate the user's REAL shielded account
   *  (see delegated-signer `getUserSigner` browser-sig branch). Idempotent: also
   *  records `walletAddress` and provisions the shielded account (`enable`). */
  bootstrapPrivacy: protectedProcedure
    .input(
      z.object({
        signature: z.string().min(1),
        address: z.string().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      const address = getAddress(input.address);
      const values = {
        userId: context.user.id,
        // Bootstrap rows have no Dynamic userId; the user's own id keeps the
        // NOT-NULL/UNIQUE column satisfied (typeids never collide with Dynamic UUIDs).
        dynamicUserId: context.user.dynamicUserId ?? context.user.id,
        walletId: "browser-sig",
        address,
        walletApiKey: "",
        keyShare: { browserSignature: input.signature },
      };
      await context.db
        .insert(userDelegation)
        .values(values)
        .onConflictDoUpdate({ target: userDelegation.userId, set: values });
      await context.db
        .update(user)
        .set({ walletAddress: address })
        .where(eq(user.id, context.user.id));
      // Provision the shielded account now (derives via the replayed signature).
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
   *  sub-cent capable). `to` = a `@username`, a raw `unlink1…` address, or
   *  "appTreasury" (a miniapp tip — needs `appId`; lands in the app owner's shielded
   *  balance). For a friend `@username` send, a "tip" money-line is recorded in the
   *  chat thread server-side (no separate recordTip round-trip). */
  privateSend: protectedProcedure
    .input(
      z.object({
        to: z.string().min(1),
        amount: z.string().min(1),
        appId: AppId.optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const amount = parseUsdc(input.amount);
      if (amount > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      const raw = input.to.trim();

      // Auto-provision a user's shielded account if absent (only possible if THEY
      // have delegated — getUserSigner resolves; else a clean error).
      const ensureUnlink = async (
        u: { id: UserId; unlinkAddress: string | null },
        absentMsg: string
      ): Promise<string> => {
        if (u.unlinkAddress) return u.unlinkAddress;
        try {
          const enabled = await context.unlink.enable(u.id);
          await context.db
            .update(user)
            .set({ unlinkAddress: enabled.unlinkAddress })
            .where(eq(user.id, u.id));
          return enabled.unlinkAddress;
        } catch {
          throw new ORPCError("BAD_REQUEST", { message: absentMsg });
        }
      };

      // resolve the recipient's shielded (unlink1…) address. Track the friend the
      // send resolved to (if any) so we can record the chat money-line after.
      let toUnlink: string;
      let friendUsername: string | null = null;
      if (raw.startsWith("unlink1")) {
        toUnlink = raw;
      } else if (raw === "appTreasury") {
        // miniapp tip → the app owner's shielded balance (mirrors resolveRecipient's
        // treasury→owner fallback; the shielded rail has no app-level account).
        if (!input.appId) {
          throw new ORPCError("BAD_REQUEST", { message: "Missing appId for a tip" });
        }
        const appRow = await requireApp(context.db, input.appId);
        const owner = await context.db.query.user.findFirst({
          columns: { id: true, unlinkAddress: true },
          where: eq(user.id, appRow.ownerUserId),
        });
        if (!owner) {
          throw new ORPCError("BAD_REQUEST", {
            message: "This jam can't receive tips yet",
          });
        }
        toUnlink = await ensureUnlink(owner, "This jam can't receive tips yet");
      } else if (raw.startsWith("@")) {
        const handle = raw.slice(1).toLowerCase();
        const u = await context.db.query.user.findFirst({
          columns: { id: true, unlinkAddress: true, username: true },
          where: eq(user.username, handle),
        });
        if (!u) {
          throw new ORPCError("BAD_REQUEST", { message: `Unknown user @${handle}` });
        }
        toUnlink = await ensureUnlink(
          u,
          `@${handle} hasn't enabled private payments yet`
        );
        friendUsername = u.username;
      } else {
        throw new ORPCError("BAD_REQUEST", { message: "Unrecognized recipient" });
      }

      const txHash = await tryOnchain(() =>
        context.unlink.transfer(context.user.id, toUnlink, amount)
      );

      // Server-authoritative chat money-line for a friend send (best-effort: the
      // money has already moved; a non-friend @send simply records no line).
      if (friendUsername) {
        await createChatService({
          db: context.db,
          rateLimiter: context.rateLimiter,
        })
          .recordPrivateTip(
            { id: context.user.id, username: context.user.username },
            friendUsername,
            formatUsdc(amount),
            txHash
          )
          .catch(() => {});
      }

      return { txHash };
    }),

  /** "Add funds" — the unified funding rail. Faucets test USDC into the caller's
   *  SHIELDED balance (the in-app wallet). `arcTestnet` = instant (platform pool →
   *  shielded). `sepolia` = the chain-abstraction path: CCTP Fast Transfer burns on
   *  Ethereum Sepolia → mints native USDC on Arc (~min), then credits the shielded
   *  balance. Server-orchestrated: the user needs no gas or cross-chain setup. The
   *  faucet button now; later reskinned as a "fake top-up" over this same handler. */
  addFunds: protectedProcedure
    .input(
      z.object({
        sourceChain: z.enum(["arcTestnet", "sepolia"]).default("arcTestnet"),
        amount: z.string().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      const amount = parseUsdc(input.amount);
      if (amount > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }
      try {
        // Ensure the caller has a shielded account (idempotent); persist the address.
        const { unlinkAddress } = await tryOnchain(() =>
          context.unlink.enable(context.user.id)
        );
        if (context.user.unlinkAddress !== unlinkAddress) {
          await context.db
            .update(user)
            .set({ unlinkAddress })
            .where(eq(user.id, context.user.id));
        }

        let bridge: { burnTxHash: Hex; mintTxHash: Hex } | null = null;
        if (input.sourceChain === "sepolia") {
          // Chain-abstracted rail (production-shaped): claim → bridge → swap-into-
          // confidential. CCTP-fast mints the USDC to the USER's Arc wallet, then we
          // deposit it into THEIR confidential balance — the same dollars flow through.
          if (!context.user.walletAddress) {
            throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
          }
          const { burnTxHash, mintTxHash, minted } = await tryOnchain(() =>
            context.onchain.fundViaCctp({
              amount,
              mintRecipient: context.user.walletAddress as Hex,
              fast: true,
            })
          );
          bridge = { burnTxHash, mintTxHash };
          // swap into the confidential asset: deposit the arrived Arc USDC → shielded.
          await tryOnchain(() => context.unlink.deposit(context.user.id, minted));
        } else {
          // Arc rail — instant: platform pool → shielded (testnet free-grant / welcome
          // path). Production Arc rail is the user's own depositPrivate.
          await tryOnchain(() => context.unlink.faucet(unlinkAddress, amount));
        }

        const shieldedUsdc = await context.unlink
          .balance(context.user.id)
          .then(formatUsdc)
          .catch(() => null);
        return {
          sourceChain: input.sourceChain,
          shieldedUsdc,
          burnTxHash: bridge?.burnTxHash ?? null,
          mintTxHash: bridge?.mintTxHash ?? null,
        };
      } catch (err) {
        // Surface the real cause: the client only ever sees a generic "couldn't
        // add funds" — without this the Unlink/CCTP fault (e.g. CHAIN_UNAVAILABLE,
        // an unfunded faucet pool, a delegated-signer failure) is invisible in logs.
        const e = err as { code?: string; message?: string };
        context.logger.error(
          {
            path: "payments.addFunds",
            source: input.sourceChain,
            code: e?.code,
            message: e?.message,
          },
          "addFunds failed"
        );
        throw err;
      }
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
