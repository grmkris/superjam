#!/usr/bin/env bun
// Seed fake users + realistic ACTIVITY into a live DB so SuperJam looks alive for
// a demo: plays, likes, reviews, friendships, DMs and app notifications. Also
// registers the deployed template games (TEMPLATE_GAMES below) owned by seed
// "makers" who are friends of OWNER — that's what makes the Friends discover tab
// (jams *made by* your friends) non-empty. Mirrors seed-demo-jams.ts.
//
//   recon (no writes):  DEV_DB_URL=<url> bun packages/api/scripts/seed-activity.ts
//   apply:              DEV_DB_URL=<url> OWNER=kristjangrm1 RUN=1 bun packages/api/scripts/seed-activity.ts
//
// Idempotent: re-running does NOT duplicate (seed users keyed by the
// @seed.superjam.fun email domain; likes/reviews/friendships use natural unique
// constraints; plays SET an absolute value; DMs/app-messages dedupe in code).
import { createDb, schema } from "@superjam/db";
import { and, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import type { AppId, AppManifest, UserId } from "@superjam/shared";
import { PLAYS_COUNTER, typeIdGenerator, typeIdToUuid } from "@superjam/shared";

const DEV_DB_URL = process.env.DEV_DB_URL;
if (!DEV_DB_URL) {
  console.error("set DEV_DB_URL to the dev Postgres public URL");
  process.exit(2);
}
const OWNER = process.env.OWNER ?? "kristjangrm1";
const RUN = process.env.RUN === "1";

// ── deterministic RNG (constant seed) so recon counts == apply writes ──────────
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rng = mulberry32(0x5eed4a);
const randInt = (n: number) => Math.floor(rng() * n);
const chance = (p: number) => rng() < p;
const pick = <T>(arr: readonly T[]): T => arr[randInt(arr.length)]!;
const shuffle = <T>(arr: readonly T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};
const fakeWallet = (): string => {
  let s = "0x";
  for (let i = 0; i < 40; i++) s += "0123456789abcdef"[randInt(16)];
  return s;
};

// ── seed people ───────────────────────────────────────────────────────────────
const HANDLES = [
  "pixelpanda", "neonwolf", "vibecheck", "gm_gary", "satoshi_lite", "cryptokat",
  "mintycel", "lumi", "dao_dora", "zkzoe", "basedbecca", "jpeg_jim", "moonmav",
  "hodlhanna", "glitchgoblin", "sundaesol", "fomofred", "wagmiwill", "ricky_rugs",
  "tessverify", "omkar", "nova_ng", "bytebeth", "frodo_b",
] as const;
const seedEmail = (h: string) => `${h}@seed.superjam.fun`;
const seedUsername = (h: string) => `seed_${h}`;
const SEED_EMAIL_DOMAIN = "%@seed.superjam.fun";

// Handles that become OWNER's friends (incl. the 3 game makers). 8 friends.
const OWNER_FRIEND_HANDLES = [
  "neonwolf", "zkzoe", "basedbecca", "pixelpanda", "gm_gary", "lumi",
  "cryptokat", "moonmav",
] as const;

// ── template games to register (entryUrl filled after `vercel deploy`) ─────────
// Leave entryUrl "" to skip a game until it's deployed. owner = a seed maker
// handle (must be in HANDLES; ideally an OWNER friend so it shows in Friends).
const TEMPLATE_GAMES: {
  manifest: AppManifest;
  entryUrl: string;
  makerHandle: string;
}[] = [
  {
    manifest: { name: "Gem Clicker", slug: "gem-clicker", description: "Tap the floating gem before the clock runs out and climb the 3D high-score board.", iconEmoji: "💎", category: "game", capabilities: [] },
    entryUrl: "https://gem-clicker.vercel.app",
    makerHandle: "neonwolf",
  },
];

// ── plays weighting per slug (target TOTAL plays; controls feed ranking) ───────
const SLUG_WEIGHT: Record<string, number> = {
  "gem-clicker": 1420,
  "world-cup-trivia": 980,
  "final-pot-demo": 720,
  "mascot-draw-off": 410,
  guestbook: 300,
  "tip-jar": 210,
  "spending-explainer": 90,
};
const DEFAULT_WEIGHT = 40;

const REVIEW_TEXTS = [
  "Genuinely fun — played three rounds with friends.",
  "Clean UI, wish it had sound effects.",
  "Lost 2 USDC, worth it lol.",
  "The judge is brutal but fair.",
  "Beat my brother twice. GG.",
  "Smooth and fast. More levels pls.",
  "Surprisingly addictive for a mini app.",
  "Crashed once but otherwise great.",
  "Love that it's verified-human only.",
  "Simple idea, executed well.",
  "Could use a leaderboard reset.",
  "10/10 would jam again.",
];

// distribute `total` across `k` rows with a decaying split, summing exactly.
const distribute = (total: number, k: number): number[] => {
  const weights = Array.from({ length: k }, (_, i) => 1 / (i + 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let rem = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rem > 0; i = (i + 1) % k, rem--) out[i]!++;
  return out;
};

const { db, pool } = createDb(DEV_DB_URL);

try {
  // ── OWNER lookup ──────────────────────────────────────────────────────────
  const owner = await db.query.user.findFirst({
    where: eq(schema.user.username, OWNER),
    columns: { id: true, username: true },
  });
  console.log(`\nowner → ${owner ? `${owner.username} (${owner.id})` : `NONE (looked for "${OWNER}")`}`);

  // ── existing seed users ───────────────────────────────────────────────────
  const existingSeed = await db.query.user.findMany({
    where: like(schema.user.email, SEED_EMAIL_DOMAIN),
    columns: { id: true, username: true, email: true },
  });
  const existingByEmail = new Map(existingSeed.map((u) => [u.email, u]));
  const toCreate = HANDLES.filter((h) => !existingByEmail.has(seedEmail(h)));
  console.log(`seed users: ${existingSeed.length} existing, ${toCreate.length} to create`);

  // Pre-compute the insert values for new users (deterministic).
  const newUserValues = toCreate.map((h) => {
    const verified = chance(0.6);
    const username = seedUsername(h);
    return {
      handle: h,
      values: {
        email: seedEmail(h),
        username,
        worldVerified: verified,
        ensName: verified ? `${username}.superjam.eth` : null,
        walletAddress: chance(0.5) ? fakeWallet() : null,
      },
    };
  });

  // ── plan summary helpers (computed below, printed in recon + apply) ────────
  const gamesToRegister = TEMPLATE_GAMES.filter((g) => g.entryUrl.trim() !== "");
  const gamesSkipped = TEMPLATE_GAMES.filter((g) => g.entryUrl.trim() === "");

  console.log("\ntemplate games:");
  for (const g of TEMPLATE_GAMES) {
    const tag = g.entryUrl.trim() ? g.entryUrl : "(no entryUrl — SKIP, deploy first)";
    console.log(`  ${g.manifest.slug.padEnd(14)} maker=seed_${g.makerHandle.padEnd(12)} ${tag}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RECON gate
  // ───────────────────────────────────────────────────────────────────────────
  if (!RUN) {
    console.log("\n--- RECON (no writes) ---");
    console.log(`would create ${toCreate.length} users; total seed users after: ${HANDLES.length}`);
    console.log(`would register ${gamesToRegister.length} template games (${gamesSkipped.length} skipped — need entryUrl)`);
    console.log(`would friend ${OWNER_FRIEND_HANDLES.length} seed users to OWNER + a peer ring`);
    console.log("plays/likes/reviews/DMs computed against listed apps at apply time.");
    console.log("\n(recon only — set RUN=1 [OWNER=<username>] to apply)");
    process.exit(0);
  }
  if (!owner) {
    console.error(`\nowner "${OWNER}" not found — cannot seed`);
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // APPLY
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n--- APPLY ---");

  // 1) users ------------------------------------------------------------------
  if (newUserValues.length) {
    await db
      .insert(schema.user)
      .values(newUserValues.map((u) => u.values))
      .onConflictDoNothing();
    console.log(`✅ inserted ${newUserValues.length} users`);
  }
  // re-read all seed users → id map by handle
  const allSeed = await db.query.user.findMany({
    where: like(schema.user.email, SEED_EMAIL_DOMAIN),
    columns: { id: true, email: true },
  });
  const idByHandle = new Map<string, UserId>();
  for (const u of allSeed) {
    const h = u.email.replace("@seed.superjam.fun", "");
    idByHandle.set(h, u.id);
  }
  const seedIds = HANDLES.map((h) => idByHandle.get(h)!).filter(Boolean);
  const ownerFriendIds = OWNER_FRIEND_HANDLES.map((h) => idByHandle.get(h)!).filter(Boolean);

  // 2) register template games (owned by seed makers) -------------------------
  const existingApps = await db.query.app.findMany({ columns: { slug: true } });
  const existingSlugs = new Set(existingApps.map((a) => a.slug));
  for (const g of gamesToRegister) {
    if (existingSlugs.has(g.manifest.slug)) {
      console.log(`  ⏭  game ${g.manifest.slug} exists — skipping`);
      continue;
    }
    const makerId = idByHandle.get(g.makerHandle);
    if (!makerId) {
      console.log(`  [warn] maker seed_${g.makerHandle} missing — skipping ${g.manifest.slug}`);
      continue;
    }
    // Direct insert of ONLY the columns that exist on dev. The local app schema
    // carries uncommitted game_contract_* columns the dev DB lacks, so drizzle's
    // full-row insert (via createExternalApp) 42703s. This mirrors the listed-app
    // shape createExternalApp produces (status "listed", no onchain ENS mint).
    const appUuid = typeIdToUuid(typeIdGenerator("app")).uuid;
    const ownerUuid = typeIdToUuid(makerId).uuid;
    const origin = new URL(g.entryUrl).origin;
    await db.execute(sql`
      insert into "app" ("id","slug","name","description","icon_emoji","category","owner_user_id","status","capabilities","entry_url","entry_origin")
      values (${appUuid}, ${g.manifest.slug}, ${g.manifest.name}, ${g.manifest.description ?? null}, ${g.manifest.iconEmoji ?? null}, ${g.manifest.category}, ${ownerUuid}, 'listed', ${JSON.stringify(g.manifest.capabilities ?? [])}::jsonb, ${g.entryUrl}, ${origin})
    `);
    console.log(`  ✅ game ${g.manifest.slug.padEnd(14)} listed  owner=seed_${g.makerHandle}`);
  }

  // 3) listed apps to attach activity to --------------------------------------
  const apps = await db
    .select({ id: schema.app.id, slug: schema.app.slug, name: schema.app.name })
    .from(schema.app)
    .where(
      and(
        inArray(schema.app.status, ["listed", "deployed"]),
        isNotNull(schema.app.entryUrl)
      )
    );
  // rank by configured weight (desc) for deterministic distribution
  const weightOf = (slug: string) => SLUG_WEIGHT[slug] ?? DEFAULT_WEIGHT;
  const ranked = [...apps].sort((a, b) => weightOf(b.slug) - weightOf(a.slug));
  console.log(`\nlisted apps: ${ranked.length} → ${ranked.map((a) => a.slug).join(", ")}`);

  // 4) plays (app_counter, _plays) — SET absolute values ----------------------
  let playRows = 0;
  let playVolume = 0;
  const playValues: { appId: AppId; counter: string; key: string; value: bigint }[] = [];
  for (const a of ranked) {
    const target = weightOf(a.slug);
    const k = Math.min(seedIds.length, Math.max(6, Math.min(14, Math.round(target / 90))));
    const parts = distribute(target, k);
    const keyUsers = shuffle(seedIds).slice(0, k);
    parts.forEach((v, i) => {
      if (v <= 0) return;
      playValues.push({ appId: a.id, counter: PLAYS_COUNTER, key: `u_${keyUsers[i]}`, value: BigInt(v) });
      playRows++;
      playVolume += v;
    });
  }
  if (playValues.length) {
    await db
      .insert(schema.appCounter)
      .values(playValues)
      .onConflictDoUpdate({
        target: [schema.appCounter.appId, schema.appCounter.counter, schema.appCounter.key],
        set: { value: sql`excluded.value` },
      });
  }
  console.log(`✅ plays: ${playRows} rows, ${playVolume} total volume`);

  // 5) likes (app_like) -------------------------------------------------------
  const likeValues: { appId: AppId; userId: UserId }[] = [];
  ranked.forEach((a, rank) => {
    const target = weightOf(a.slug);
    const count = Math.min(seedIds.length, Math.max(2, Math.round(target * 0.06)));
    const likers = new Set(shuffle(seedIds).slice(0, count));
    // top-4 apps: ensure OWNER's friends like them → friendsLiked signal shows
    if (rank < 4) for (const f of ownerFriendIds) likers.add(f);
    for (const userId of likers) likeValues.push({ appId: a.id, userId });
  });
  if (likeValues.length) {
    await db.insert(schema.appLike).values(likeValues).onConflictDoNothing();
  }
  console.log(`✅ likes: ${likeValues.length} rows`);

  // 6) reviews (app_review) — ~35% of likers, positive-skewed -----------------
  const RATING_POOL = [5, 5, 5, 4, 4, 4, 3, 5, 2];
  const reviewValues: { appId: AppId; userId: UserId; rating: number; text: string }[] = [];
  // group likers by app from likeValues
  const likersByApp = new Map<AppId, UserId[]>();
  for (const l of likeValues) {
    const arr = likersByApp.get(l.appId) ?? [];
    arr.push(l.userId);
    likersByApp.set(l.appId, arr);
  }
  for (const [appId, likers] of likersByApp) {
    for (const userId of likers) {
      if (!chance(0.35)) continue;
      reviewValues.push({ appId, userId, rating: pick(RATING_POOL), text: pick(REVIEW_TEXTS) });
    }
  }
  if (reviewValues.length) {
    await db.insert(schema.appReview).values(reviewValues).onConflictDoNothing();
  }
  const ratingHist = reviewValues.reduce<Record<number, number>>((m, r) => {
    m[r.rating] = (m[r.rating] ?? 0) + 1;
    return m;
  }, {});
  console.log(`✅ reviews: ${reviewValues.length} rows  ratings=${JSON.stringify(ratingHist)}`);

  // 7) friendships (peer ring + OWNER edges) ----------------------------------
  const canonicalPair = (a: UserId, b: UserId): [UserId, UserId] => (a < b ? [a, b] : [b, a]);
  const pairKey = (a: UserId, b: UserId) => canonicalPair(a, b).join("|");
  const pairs = new Map<string, [UserId, UserId]>();
  // peer ring: each seed befriends the next 1-2 by index
  for (let i = 0; i < seedIds.length; i++) {
    const a = seedIds[i]!;
    for (const off of [1, 2]) {
      const b = seedIds[(i + off) % seedIds.length]!;
      if (a === b) continue;
      const [x, y] = canonicalPair(a, b);
      pairs.set(pairKey(x, y), [x, y]);
    }
  }
  // OWNER edges
  let ownerEdges = 0;
  for (const f of ownerFriendIds) {
    const [x, y] = canonicalPair(owner.id as UserId, f);
    if (!pairs.has(pairKey(x, y))) ownerEdges++;
    pairs.set(pairKey(x, y), [x, y]);
  }
  const friendValues = [...pairs.values()].map(([userAId, userBId]) => ({ userAId, userBId }));
  if (friendValues.length) {
    await db.insert(schema.friendship).values(friendValues).onConflictDoNothing();
  }
  console.log(`✅ friendships: ${friendValues.length} rows (${ownerEdges} new involving OWNER)`);

  // 8) DMs (with OWNER + fake↔fake) -------------------------------------------
  // existing seed-involving DMs → dedupe set
  const existingDms = await db
    .select({ from: schema.directMessage.fromUserId, to: schema.directMessage.toUserId, kind: schema.directMessage.kind, text: schema.directMessage.text, card: schema.directMessage.card })
    .from(schema.directMessage)
    .where(
      or(
        inArray(schema.directMessage.fromUserId, seedIds),
        inArray(schema.directMessage.toUserId, seedIds)
      )
    );
  const dmKey = (from: UserId, to: UserId, kind: string, label: string) => `${from}|${to}|${kind}|${label}`;
  const seenDm = new Set(
    existingDms.map((d) => dmKey(d.from, d.to, d.kind, d.text ?? d.card?.title ?? ""))
  );

  type DmInsert = typeof schema.directMessage.$inferInsert;
  type DmSpec = Omit<DmInsert, "createdAt">;
  // Build ALL specs deterministically first (no RNG gated behind dedupe), then
  // filter + stamp createdAt by index — so a re-run consumes RNG identically and
  // inserts nothing new (the skip-path no longer perturbs the sequence).
  const specs: DmSpec[] = [];

  // OWNER threads with up to 5 friends
  const ownerThreadFriends = ownerFriendIds.slice(0, 5);
  const ownerSlugFor = (i: number) => ["world-cup-trivia", "gem-clicker", "final-pot-demo"][i % 3]!;
  ownerThreadFriends.forEach((fid, i) => {
    specs.push({ fromUserId: fid, toUserId: owner.id, kind: "text", text: "yo did you try the new jam?", read: false });
    specs.push({ fromUserId: owner.id, toUserId: fid, kind: "text", text: "not yet — drop the link?", read: true });
    const slug = ownerSlugFor(i);
    specs.push({
      fromUserId: fid,
      toUserId: owner.id,
      kind: "card",
      text: "beat my score 😤",
      card: { title: slug.replace(/-/g, " "), icon: "🎮", body: "I just set a new high score", cta: "Play" },
      link: `/app/${slug}`,
      read: false,
    });
  });
  // one tip DM to OWNER (written directly — no on-chain settle)
  if (ownerThreadFriends[0]) {
    specs.push({
      fromUserId: ownerThreadFriends[0],
      toUserId: owner.id,
      kind: "tip",
      text: "sent 2.00 USDC 🎁",
      amountUsdc: "2.00",
      txHash: `0xseed${"0".repeat(60)}`,
      read: false,
    });
  }
  // fake↔fake threads (6 pairs) — deterministic + unique text per message
  const OPENERS = ["gg wp", "rematch?", "you're cracked at this", "one more round", "lol no way", "good game"];
  const REPLIES = ["any time 😎", "say less", "loser buys coffee", "bet", "next time", "🤝"];
  for (let i = 0; i < 6; i++) {
    const a = seedIds[i % seedIds.length]!;
    const b = seedIds[(i * 5 + 3) % seedIds.length]!;
    const [x, y] = a === b ? [a, seedIds[(i + 1) % seedIds.length]!] : [a, b];
    specs.push({ fromUserId: x, toUserId: y, kind: "text", text: OPENERS[i]!, read: i % 2 === 0 });
    specs.push({ fromUserId: y, toUserId: x, kind: "text", text: REPLIES[i]!, read: i % 3 === 0 });
  }

  // filter against existing, then stamp staggered createdAt by index
  const now = Date.now();
  const fresh = specs.filter((s) => {
    const label = s.text ?? (s.card as { title?: string } | undefined)?.title ?? "";
    const key = dmKey(s.fromUserId as UserId, s.toUserId as UserId, s.kind ?? "text", label);
    if (seenDm.has(key)) return false;
    seenDm.add(key);
    return true;
  });
  const dmValues: DmInsert[] = fresh.map((s, i) => ({
    ...s,
    createdAt: new Date(now - (i * 13 + 7) * 60_000),
  }));
  if (dmValues.length) {
    await db.insert(schema.directMessage).values(dmValues);
  }
  const unreadToOwner = dmValues.filter((d) => d.toUserId === owner.id && d.read === false).length;
  console.log(`✅ DMs: ${dmValues.length} rows (${unreadToOwner} unread to OWNER)`);

  // 9) app notifications (app_message → OWNER) --------------------------------
  const appBySlug = new Map(ranked.map((a) => [a.slug, a]));
  const ownerByApp = await db
    .select({ id: schema.app.id, slug: schema.app.slug, owner: schema.app.ownerUserId })
    .from(schema.app)
    .where(inArray(schema.app.slug, ["final-pot-demo", "guestbook"]));
  const notifPlan: { slug: string; text: string; link: string }[] = [
    { slug: "final-pot-demo", text: "Your stake won — 4.50 USDC paid out 🎉", link: "/app/final-pot-demo" },
    { slug: "guestbook", text: "Someone signed your guestbook and left a tip", link: "/app/guestbook" },
  ];
  const existingNotifs = await db
    .select({ appId: schema.appMessage.appId, to: schema.appMessage.toUserId, text: schema.appMessage.text })
    .from(schema.appMessage)
    .where(eq(schema.appMessage.toUserId, owner.id));
  const seenNotif = new Set(existingNotifs.map((n) => `${n.appId}|${n.to}|${n.text}`));
  type AppMsgInsert = typeof schema.appMessage.$inferInsert;
  const notifValues: AppMsgInsert[] = [];
  for (const n of notifPlan) {
    const a = ownerByApp.find((x) => x.slug === n.slug) ?? appBySlug.get(n.slug);
    if (!a) continue;
    const appId = a.id;
    const fromUserId = "owner" in a ? a.owner : owner.id;
    if (!fromUserId) continue;
    const key = `${appId}|${owner.id}|${n.text}`;
    if (seenNotif.has(key)) continue;
    notifValues.push({ appId, fromUserId, toUserId: owner.id, text: n.text, link: n.link, read: false });
  }
  if (notifValues.length) {
    await db.insert(schema.appMessage).values(notifValues);
  }
  console.log(`✅ app notifications: ${notifValues.length} rows to OWNER`);

  console.log("\ndone.");
} finally {
  await pool.end();
}
