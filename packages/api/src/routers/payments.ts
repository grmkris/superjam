// payments (§12/§13/§15). `relay` is the gasless public-rail transport: the user
// signs an EIP-3009 authorization (buildTransferAuth) and we submit it, pay the
// ETH, and return the REAL tx hash — the caller then proves it via publish.submit
// / pot.stake. `mine` is the user's public-rail ledger. Every money move (tips,
// pay-a-friend, in-jam payUSDC, publish fee, pot stake) rides this one rail.
import { schema } from "@superjam/db";
import { AppId, TX_CAP_USDC } from "@superjam/shared";
import {
  OnchainError,
  PUBLIC_CHAIN,
  USDC,
  authWindow,
  buildTransferAuth,
  formatUsdc,
  parseUsdc,
  randomTransferNonce,
  usdc,
} from "@superjam/onchain";
import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { getAddress, type Hex, isAddressEqual } from "viem";
import { z } from "zod";
import type { ApiContext } from "../context.ts";
import { requireApp } from "../lib/app-context.ts";
import { tryOnchain } from "../lib/onchain-errors.ts";
import { Hex0x, TxHash, Uint } from "../lib/validators.ts";
import { protectedProcedure } from "../orpc.ts";
import { createChatService } from "../services/chat-service.ts";

const { publishPayment, potStake, user } = schema;

const TX_CAP = parseUsdc(TX_CAP_USDC);

// The EIP-3009 authorization, wire form: bigints as decimal-integer strings.
const AuthorizationInput = z.object({
  from: Hex0x,
  to: Hex0x,
  value: Uint, // USDC base units (6-dec)
  validAfter: Uint, // unix seconds
  validBefore: Uint, // unix seconds
  nonce: TxHash, // 32-byte hex
});

// Resolve a confirm-sheet recipient string → on-chain address. `to` is "appTreasury"
// (a tip — needs appId), a "@username" (pay a friend), "potEscrow", or an already-0x
// address. Shared by the browser relay (`resolveRecipient`) and the server-signed
// relay (`relayDelegated`) so the two never drift on who can receive money.
async function resolveRecipientAddress(
  context: ApiContext,
  to: string,
  appId?: z.infer<typeof AppId>
): Promise<{ address: `0x${string}`; displayName: string | undefined }> {
  const raw = to.trim();

  // already an address
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    return { address: getAddress(raw), displayName: undefined };
  }

  // pay a friend: @username
  if (raw.startsWith("@")) {
    const handle = raw.slice(1).toLowerCase();
    const u = await context.db.query.user.findFirst({
      columns: { walletAddress: true, username: true },
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
      displayName: `@${u.username}`,
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
    if (!appId) {
      throw new ORPCError("BAD_REQUEST", { message: "Missing appId for a tip" });
    }
    const appRow = await requireApp(context.db, appId);
    let address = appRow.treasuryAddress;
    let displayName: string | undefined = appRow.name ?? undefined;
    if (!address) {
      const owner = await context.db.query.user.findFirst({
        columns: { walletAddress: true, username: true },
        where: eq(user.id, appRow.ownerUserId),
      });
      address = owner?.walletAddress ?? null;
      displayName = displayName ?? (owner ? `@${owner.username}` : undefined);
    }
    if (!address) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This jam can't receive tips yet",
      });
    }
    return { address: getAddress(address), displayName };
  }

  throw new ORPCError("BAD_REQUEST", { message: "Unrecognized recipient" });
}

export const paymentsRouter = {
  // Turn a confirm-sheet recipient into an on-chain address for the host's relay
  // executor (DESIGN_BRIEF §3d). The resolved 0x is what the browser signs the
  // EIP-3009 auth against.
  resolveRecipient: protectedProcedure
    .input(z.object({ to: z.string().min(1), appId: AppId.optional() }))
    .handler(({ context, input }) =>
      resolveRecipientAddress(context, input.to, input.appId)
    ),

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

  /** Server-signed relay (Dynamic Delegated Access, §23). Same public rail as
   *  `relay`, but the SERVER produces the user's EIP-712 signature via their
   *  delegated MPC key share — no browser, no popup. Drives background/scheduled
   *  payments and the MCP act-as-user flow (the `sjat_` PAT resolves to
   *  `context.user`). Requires the user to have enabled delegation. */
  relayDelegated: protectedProcedure
    .input(
      z.object({
        to: z.string().min(1),
        appId: AppId.optional(),
        amountUsdc: z.string().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      if (!context.delegatedSigner) {
        throw new ORPCError("INTERNAL", {
          message: "Delegated signing is not configured on this server",
        });
      }
      if (!context.user.walletAddress) {
        throw new ORPCError("BAD_REQUEST", { message: "No wallet on file" });
      }
      if (!(await context.delegatedSigner.hasDelegation(context.user.id))) {
        throw new ORPCError("FORBIDDEN", {
          message: 'Enable "Let SuperJam act for you" first',
        });
      }

      const value = parseUsdc(input.amountUsdc);
      if (value > TX_CAP) {
        throw new ORPCError("BAD_REQUEST", { message: "Over the per-tx cap" });
      }

      const { address: to } = await resolveRecipientAddress(
        context,
        input.to,
        input.appId
      );
      const from = getAddress(context.user.walletAddress);
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const { validAfter, validBefore } = authWindow(nowSec);
      const typed = buildTransferAuth({
        usdc: USDC[PUBLIC_CHAIN],
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce: randomTransferNonce(),
      });

      const signature = await context.delegatedSigner.signTransferAuth(
        context.user.id,
        typed
      );
      const txHash = await tryOnchain(() =>
        context.onchain.relayTransfer({
          chain: PUBLIC_CHAIN,
          authorization: typed.message,
          signature,
        })
      );

      // Pay-a-friend → record a chat money-line (best-effort), mirroring the
      // browser path's payments.recordTip.
      if (input.to.trim().startsWith("@")) {
        await createChatService({
          db: context.db,
          rateLimiter: context.rateLimiter,
        })
          .recordTip(
            { id: context.user.id, username: context.user.username },
            input.to.trim().slice(1),
            input.amountUsdc,
            txHash
          )
          .catch(() => {});
      }
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

  /** Record a completed pay-a-friend as a chat money-line. The public-rail relay
   *  already moved the USDC (browser-signed EIP-3009 → payments.relay); we trust
   *  the returned txHash and write the line. Friends-only + idempotent on txHash. */
  recordTip: protectedProcedure
    .input(
      z.object({
        toUsername: z.string().min(1),
        amountUsdc: z.string().min(1),
        txHash: z.string().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await createChatService({
        db: context.db,
        rateLimiter: context.rateLimiter,
      })
        .recordTip(
          { id: context.user.id, username: context.user.username },
          input.toUsername,
          input.amountUsdc,
          input.txHash
        )
        .catch(() => {});
      return { ok: true as const };
    }),
};

// Surface the chain id for callers that record receipts.
export const PUBLIC_CHAIN_ID = USDC[PUBLIC_CHAIN].chainId;
