import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";

setDefaultTimeout(20_000);
import { createTestAuth } from "../auth/test-auth.ts";
import { createContext } from "../context.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { appRouter } from "../router.ts";
import { createExternalApp } from "./apps.ts";
import { createTestUser } from "../testing/factories.ts";

const logger = createLogger({ level: "silent" });

const harness = async () => {
  const { db } = await createPgliteDb();
  const auth = await createTestAuth();
  const rateLimiter = createRateLimiter();
  const ctxFor = (token?: string) =>
    createContext({
      db,
      logger,
      auth: auth.verifier,
      rateLimiter,
      headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    });
  const tokenFor = (u: { dynamicUserId: string | null; email: string }) =>
    auth.sign({ dynamicUserId: u.dynamicUserId!, email: u.email });
  return { db, ctxFor, tokenFor };
};

const twoFriends = async (h: Awaited<ReturnType<typeof harness>>) => {
  const alice = await createTestUser(h.db, { username: "alice" });
  const bob = await createTestUser(h.db, { username: "bob" });
  const aliceTok = await h.tokenFor(alice);
  const bobTok = await h.tokenFor(bob);
  await call(appRouter.friends.add, { username: "bob" }, { context: h.ctxFor(aliceTok) });
  return { alice, bob, aliceTok, bobTok };
};

describe("chat friendship gate", () => {
  test("non-friends cannot message / read history", async () => {
    const h = await harness();
    const alice = await createTestUser(h.db, { username: "alice" });
    const bob = await createTestUser(h.db, { username: "bob" });
    const aliceTok = await h.tokenFor(alice);
    await expect(
      call(appRouter.chat.send, { to: "bob", text: "hi" }, { context: h.ctxFor(aliceTok) })
    ).rejects.toBeInstanceOf(ORPCError);
    await expect(
      call(appRouter.chat.history, { withUsername: "bob" }, { context: h.ctxFor(aliceTok) })
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("chat send + history + threads", () => {
  test("text both directions; fromMe per viewer; threads unread + markRead", async () => {
    const h = await harness();
    const { aliceTok, bobTok } = await twoFriends(h);

    await call(appRouter.chat.send, { to: "bob", text: "gg" }, { context: h.ctxFor(aliceTok) });
    await call(appRouter.chat.send, { to: "alice", text: "rematch?" }, { context: h.ctxFor(bobTok) });

    const aliceView = await call(
      appRouter.chat.history,
      { withUsername: "bob" },
      { context: h.ctxFor(aliceTok) }
    );
    expect(aliceView.messages).toHaveLength(2);
    // newest-first: bob's "rematch?" then alice's "gg"
    expect(aliceView.messages[0]!.text).toBe("rematch?");
    expect(aliceView.messages[0]!.fromMe).toBe(false);
    expect(aliceView.messages[1]!.fromMe).toBe(true);

    const bobThreads = await call(appRouter.chat.threads, undefined, {
      context: h.ctxFor(bobTok),
    });
    expect(bobThreads.threads).toHaveLength(1);
    expect(bobThreads.threads[0]!.withUser.username).toBe("alice");
    expect(bobThreads.totalUnread).toBe(1); // alice's "gg" is unread for bob

    await call(appRouter.chat.markRead, { withUsername: "alice" }, { context: h.ctxFor(bobTok) });
    const after = await call(appRouter.chat.threads, undefined, { context: h.ctxFor(bobTok) });
    expect(after.totalUnread).toBe(0);
  });
});

describe("chat shareJam (card + deeplink)", () => {
  test("challenge builds a card + a /app/<slug>?d= link decoding to {challengedBy}", async () => {
    const h = await harness();
    const { alice, aliceTok } = await twoFriends(h);
    // a listed jam owned by alice
    await createExternalApp(h.db, {
      manifest: {
        name: "Trivia",
        slug: "trivia",
        description: "quiz",
        iconEmoji: "🎯",
        category: "game",
        capabilities: [],
      },
      entryUrl: "https://trivia.vercel.app",
      ownerUserId: alice.id,
    });

    await call(
      appRouter.chat.shareJam,
      { to: "bob", jamSlug: "trivia", challenge: true, note: "beat my 4/5" },
      { context: h.ctxFor(aliceTok) }
    );

    const hist = await call(
      appRouter.chat.history,
      { withUsername: "bob" },
      { context: h.ctxFor(aliceTok) }
    );
    const msg = hist.messages[0]!;
    expect(msg.kind).toBe("card");
    expect(msg.card?.title).toBe("Trivia");
    expect(msg.card?.cta).toBe("Accept challenge");
    expect(msg.via?.name).toBe("Trivia");
    // link → /app/trivia?d=<encoded base64 of {challengedBy:"alice"}>
    const d = new URL(`https://x${msg.link}`).searchParams.get("d")!;
    const payload = JSON.parse(Buffer.from(d, "base64").toString("utf8"));
    expect(payload).toEqual({ challengedBy: "alice" });
  });

  test("share (no challenge) → cta Play, plain /app/<slug>; unknown jam → NOT_FOUND", async () => {
    const h = await harness();
    const { alice, aliceTok } = await twoFriends(h);
    await createExternalApp(h.db, {
      manifest: {
        name: "Doodle",
        slug: "doodle",
        description: "draw",
        iconEmoji: "🎨",
        category: "game",
        capabilities: [],
      },
      entryUrl: "https://doodle.vercel.app",
      ownerUserId: alice.id,
    });
    await call(
      appRouter.chat.shareJam,
      { to: "bob", jamSlug: "doodle" },
      { context: h.ctxFor(aliceTok) }
    );
    const hist = await call(
      appRouter.chat.history,
      { withUsername: "bob" },
      { context: h.ctxFor(aliceTok) }
    );
    expect(hist.messages[0]!.card?.cta).toBe("Play");
    expect(hist.messages[0]!.link).toBe("/app/doodle");

    await expect(
      call(
        appRouter.chat.shareJam,
        { to: "bob", jamSlug: "nope" },
        { context: h.ctxFor(aliceTok) }
      )
    ).rejects.toBeInstanceOf(ORPCError);
  });
});

describe("chat recordTip", () => {
  test("records a tip money line", async () => {
    const h = await harness();
    const { aliceTok } = await twoFriends(h);
    await call(
      appRouter.chat.recordTip,
      { to: "bob", amountUsdc: "1.00", txHash: "0xabc" },
      { context: h.ctxFor(aliceTok) }
    );
    const hist = await call(
      appRouter.chat.history,
      { withUsername: "bob" },
      { context: h.ctxFor(aliceTok) }
    );
    expect(hist.messages[0]!.kind).toBe("tip");
    expect(hist.messages[0]!.amountUsdc).toBe("1.00");
  });
});
