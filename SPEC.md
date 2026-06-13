# SuperJam — one-shot build spec (ETHGlobal NYC 2026)

_v3, 2026-06-12 — adds explore/discovery, similar-check, remix, and
messaging + deeplinks as core. Companion to `mini-app-host-platform.md` (strategy/why).
This file is written to be handed to a coding agent at Friday kickoff and
implemented end-to-end without human decisions mid-flight. Code starts at
kickoff (scratch track); this doc is planning. House patterns from
sonara/stylelab/invok — patterns, not code._

**One-liner:** SuperJam is a super-app host: email login → embedded EVM wallet
(Dynamic), third-party mini apps in sandboxed iframes with an injected SDK
(wallet + profile + **storage + shared data**), an AI agent that builds + deploys
new mini apps from a prompt, gated by World ID + a pay-to-publish fee in USDC.
Verified humans get their own ENS name (`username.superjam.eth`, registered on
Sepolia, subnames agent-minted via Durin on Base Sepolia) and their apps
publish UNDER it: `appslug.username.superjam.eth` — a user-owned,
onchain-enumerable app namespace. (Testnet-only event, §15.1. Optional §16
upgrade: DNSSEC-import the `superjam.fun` web domain into ENS so the ENS name
and the URL become the same string — one-constant swap, roadmap if DS
propagation drags.)

**Differentiators (verified white space, 2026-06-10):**
- No wallet-bearing mini-app platform (Telegram/Farcaster/World/Base MiniKit)
  gives apps host-provided storage; the ones that do (websim, Devvit) have no
  wallet/identity. SuperJam SDK = wallet + identity + per-user KV + shared
  collections → AI-generated apps get sybil-resistant leaderboards, zero backend.
- ENS prior art all names *the agent*; nobody makes agent **outputs** first-class
  ENS citizens. SuperJam's marketplace is enumerable from ENS records alone.
- **Pitch comp (use it — viral 2026-06-10):** Shopify's internal "Quick"
  (shopify.engineering/quick) proved this exact primitive set — folder→URL +
  db/AI/identity/realtime APIs, keys server-side — transforms how people build,
  but their own admission is "this only works because it's internal." SuperJam
  is the same move on the open web: **World ID replaces the IAP firewall, the
  sandbox replaces the trust bubble, the wallet adds money.**
  One-liner: *"Quick for the open web, with money."*

---

## 0. How to use this spec (one-shot protocol)

For the implementing agent:

1. Work through milestones **M0→M9 (§20) strictly in order**. After each
   milestone: `bun run typecheck && bun run lint && bun test` must pass →
   commit (one commit per milestone minimum) → push `dev`.
2. **Core creds are ASSUMED PRESENT** (decision 2026-06-13, simplifies the
   build): Dynamic, Gemini, World app, ENS/Durin registry — all live from M0;
   no auth-bypass, no LLM mock, no world/ens off-modes. The only mode flag is
   `BUILDER_MODE` (§5.1, debug escape hatch). Tests stub externals at the
   code seam (fixture builder, mock viem client), not via env flags.
3. Don't run the app locally for verification beyond smoke needs — the house
   flow is: fast static checks locally, push `dev`, test on the dev URL.
   Exception: M3's iframe loop may be verified with `bun run dev` + browser
   once, since the bridge is the riskiest unit.
4. When a third-party API detail conflicts with this spec, the **live docs win**
   (Dynamic/World/Durin are fast-moving) — but the *shape* of our abstractions
   (§ contracts) stays fixed; adapt inside the adapter, not at call sites.
5. Anything marked **(stretch)** is skipped unless all core milestones are done.
6. Scope discipline: if a decision is not covered here, choose the smallest
   thing that keeps the demo script (§22) true, and leave a `// SPEC-GAP:` comment.

---

## 1. Required inputs manifest (filled by Kristjan before/at kickoff)

Core rows are REQUIRED at kickoff (no mock fallbacks — §0.2); stretch rows
optional.

| Var | Where it comes from | Blocks (real mode only) |
|---|---|---|
| `DATABASE_URL` | Railway Postgres / local docker | — (compose provides local) |
| `S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET` | Railway bucket / local MinIO | — (compose provides local) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | aistudio.google.com (free tier) | PRIMARY refine (Gemini generateObject, platform-side, §11; else builder-agent fallback / mock) |
| `BUILDER_TOKEN` | `~/.config/turbojam/builder.env` on kristjan-dev — already generated | remote agent builds (else oneshot/mock) |
| `DYNAMIC_ENVIRONMENT_ID` | Dynamic dashboard (confirm-popup OFF, origins allowlisted) | ALL login — required |
| `WORLD_APP_ID`, `WORLD_ACTION=publish-app` | developer.world.org portal | verify + trial gate — required |
| `ENS_L2_REGISTRY` | Durin registry deployed pre-event (**Base Sepolia** — testnet-only event posture, §15.1) | ENS mint — required |
| `ENS_PARENT_NODE` | `namehash("superjam.eth")` (registered on **Sepolia** ENS, §16/§23; the DNSSEC-`superjam.fun` parent is an optional Sepolia-only upgrade) | ENS mint |
| `DYNAMIC_API_TOKEN` | Dynamic dashboard | the agent's ONCHAIN signer: a Dynamic **server wallet** (TSS-MPC — no raw private key anywhere; `@dynamic-labs-wallet/node-evm` + viem interop) that mints ENS subnames (§11 step 5) + registers ERC-8004 (§16). Funded with Sepolia + Base Sepolia ETH. Behind ONE viem-account adapter seam in `packages/onchain` — a funded plain key is a 10-min swap if the §23 rehearsal fails. Doubles as the Dynamic "Best Agentic Build" submission |
| `TREASURY_ADDRESS` | platform wallet | publish-fee payments |
| `UNLINK_API_KEY` (+ Unlink `appId`) | dashboard.unlink.xyz | the PRIVACY rail: confidential tips on Arc testnet (§15); missing ⇒ tips fall back to public Base Sepolia transfers |
| `CIRCLE_GATEWAY_*` + `ARC_PAYER_EOA_KEY` (gated) | `@circle-fin/x402-batching` config + a funded plain payer EOA on Arc testnet | `sdk.payments.payX402` private-nanopayment leg (§3/§9/§15 — gated, cut-first); missing ⇒ method disabled, private tips unaffected |
| `BASE_SEPOLIA_RPC_URL`, `SEPOLIA_RPC_URL` | public or Alchemy | onchain (Base Sepolia core + Sepolia ENS L1) |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.network` | Arc testnet (privacy rail — Unlink, §15) |
| `ERC8004_REGISTRY` | ERC-8004 registry on Base Sepolia/Sepolia (same CREATE2 address expected as mainnet `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` — verify §23; else deploy the permissionless reference registry, still testnet) | ENSIP-25 agent verification |

Web build args: `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`,
`NEXT_PUBLIC_WORLD_APP_ID`.

---

## 2. Product surface (pages + flows)

**Design direction: "Toybox"** (light/playful/hand-made — cream paper, ink
outlines, sticker shadows, Baloo 2; apps are **"jams"**; AI/build machinery
hidden from users). Full look/feel + per-screen spec in `docs/DESIGN_BRIEF.md`
and `docs/DESIGN_SPONSORS.md` — **the builder MUST read both**; this section is
the behavioral contract, those own the visuals.

> **ENS naming in the examples below** uses the family form
> `jam.user.superjam.<tld>` (e.g. `tipjar.kris.superjam.fun`). The **parent
> TLD is governed by §16** (currently `.eth` on the Sepolia/Base ship-path,
> DNSSEC-`.fun` as the upgrade) — read the suffix in the examples as
> illustrative of the *hierarchy*, not the final TLD. The **web deep link**
> `superjam.fun/<user>/<slug>` is always on the `.fun` web domain regardless.
> (The `docs/design/` round-8 mockups render `superjam.xyz` as a placeholder
> web domain — **disregard the `.xyz`**: web is `superjam.fun`, ENS parent is
> `superjam.eth` per §16. The mockups are authoritative for look + UX, the
> spec for domains/contracts.)

**Navigation:** three bottom tabs — **Make · Discover · Inbox** (Discover is the
default landing); profile + crew live behind a `@kris ▾` chip, not a tab.
First-run order: **Welcome (onboarding) → Discover → Make → Inbox**. Routes
below keep their paths; the *labels/surfaces* are the Toybox ones.

`apps/web` routes (App Router):

| Route | Contents |
|---|---|
| `/welcome` | **Onboarding** (Dynamic): (1) email → "Continue" (embedded wallet created silently; copy "a wallet appears with it — no seed phrase"). (2) **Claim your name**: claim `<name>.superjam.fun` (the user's ENS identity, minted HERE at signup, not at first build) with live availability + a preview of jams hanging under it (`tipjar.<name>.superjam.fun`). Preserves a pending invite deeplink through the flow |
| `/` | **Discover** (default tab): a **TikTok-style vertical feed** of jams, NOT a grid. One jam fills the screen, next peeks below; swipe for the next. Feed card: live jam preview / **Play (runs the jam right in the feed)**, name, **name tag** (`tipjar.<owner>.superjam.fun`, ↗ Basescan), "by @owner ✓", action rail (❤️ like+count, 🏆 scores, 💬 comments, 🔁 remix, ↗ share), **🔁 remix-of `<parent>`** chip when lineage exists. Chain facts are **inline + tappable → Basescan** — there is **NO "source: DB / ENS" toggle** (removed; §16). Tapping 💬 or the card → the **jam page**: the jam + **Comments · Reviews** tabs, full name tag, remix lineage, "🛠 built by `<maker>` · ★rating" (ⓘ → builder profile, §`/agents`). Reviews/comments are World-gated (`★4.6 · 12 verified reviews`, every row ✓-human; not-verified → "Verify to review" / verified → ★ picker + ≤280-char text / already-reviewed → edit-in-place). Server: feed order via sort signals (New/Trending/Top computed, no visible sort UI); search optional |
| `/build` | **Make** tab (a sequence of beats, NOT a labeled "wizard"; AI/build machinery hidden — no file names, logs, terminals, "agent"). (0) **Make home**: a "what do you want to make?" idea box + **optional file attachments** (`.csv/.json/.png/.jpg`, ≤2MB each, ≤4; copy: "have an Excel sheet? export it as CSV" — xlsx-via-sheetjs = cuttable stretch) + a **past-jams shelf** below (a jam baking does NOT block starting a new one). (1) **Follow-ups** (a distinct beat AFTER the idea is submitted): `builds.refine` → 2–4 tappable option chips **plus** a "your comments" stack (queue single-line notes as bullets, ✕/＋) → one "**Draw up the plan →**" sends chips + notes together (one round, max two; skipped if the prompt is already precise). If refine returns `similar` (§11), a **"Similar jams exist"** card surfaces here: ≤3 rows (icon, name, reason) with **Open** / **Remix** / dismiss "Make mine anyway" — once per session, never after the plan is confirmed. **Remix mode** (`/build?remixOf=<slug>`): the idea box pre-fills — header "Based on **<name>** by @owner", read-only recipe summary (`apps.recipe`), box labeled "Your changes"; refine receives `remixOfAppId`. (2) **The plan**: the jam rendered human-readably as *what's inside the toy* (not a code spec) + a ✏️ "change anything" box that re-refines as a **visible exchange** ("make the leaderboard monthly" → "Done") + an **editable name + ENS address row** (`tipjar` → `tipjar.<name>.superjam.fun`, slug auto-under the claimed name — the name itself was claimed at signup). (3) **Choose your builder** (the agent picker): default "SuperJam Builder ⚡ free"; community ERC-8004 builders show ★ on-chain feedback, jams built, speed, the cut kept, and ⓘ → builder profile (§`/agents`) — picking a paid one runs the confirm sheet, USDC → the builder's wallet, BEFORE dispatch (build fee = attempt fee, no refunds — say so). (4) **First-jam gate**: World ID fires **once** here, right as the first jam dispatches (also covers publish/remix); quota hit → same gate. (5) **Making it (workshop)**: NO build feed — instead the jam's UI **paints itself in live** on a mini canvas (live-preview stretch; degrades to skeleton) beside workshop steps + candy progress ("Shaping the jar ✓", "**Hanging the name tag** ⛓ .`<name>`.superjam.fun", …); `builds.get` poll 1.5s under the hood. Leaving is fine (keeps baking → shelf). (6) **Reveal**: confetti + the jam wearing its name tag + a **copyable deep link** `superjam.fun/<owner>/<slug>` → auto-open `/app/[slug]` |
| `/app/[slug]` | **Jam page / viewer** (also reachable as `superjam.fun/<owner>/<slug>` deep link): header (name, **name tag** ensName → Basescan, "by @owner ✓", tip button, **Remix button**, "🔁 remix-of <parent>" link + remix count when lineage exists, play count, **"🛠 built by `<maker>` · ★"** with ⓘ → builder profile), collapsible **Recipe panel** (original prompt + human-readable AppSpec — public for every listed jam), **Comments · Reviews** (the Reviews tab = aggregate `★4.6 · 12 verified reviews`, write-box three states — not-verified → "Verify to review" CTA / verified → ★ picker + ≤280-char text / already-reviewed → edit-in-place — rows `@username ✓ · ★★★★☆ · text · relative time`, every reviewer World-verified BY CONSTRUCTION; Comments tab = World-gated too), sandboxed iframe filling viewport, **confirm sheet** renders here (bottom sheet over iframe). Parses `?d=<base64url JSON ≤2KiB>` → zod Json → held as the jam's `launch` payload (delivered via `app.context`, §9); invalid/oversized `d` silently dropped, jam loads normally |
| `/me` | **Profile** (behind the `@kris ▾` chip, not a tab; other users' profiles visitable via any `@name`): name + ENS (`<name>.superjam.fun`) + ✓-human badge, **wallet block** (address + USDC balance hero + **Top up** `profile.topup` §15.1 — worldVerified, 1/day, seeds both rails — + recent activity), World ID status + verify, **your jams** (status, "publish" → pay-publish-fee, "iterate" → `/build?appId=`), **your registered builders** (each → its builder profile), build history |
| `/app/[slug]/manage` | Owner only: delist, iterate, **ENS records view** (key→value rows; **Retry** when a mint failed — calm state, a mint failure never fails a make) |
| `/agents` | **Builder-agent marketplace / Choose-your-builder + Register**: cards (name, agent ENS, "backed by a real human ✓", price, jams built, ★ on-chain feedback, owner @username, **ⓘ → builder profile**); a **builder profile** is a de-jargoned page rendered from the on-chain **ERC-8004** record (fetched description + URL lead; agent id, operator ✓ human, registered-since, feedback/score below — no "ERC-8004" headline chip). **Register your builder** (worldVerified only — AgentKit human-backed): name under owner (`forge.<name>.superjam.fun`), endpoint URL, price (≤ AGENT_PRICE_MAX_USDC), payout wallet → ERC-8004 identity + on-chain feedback profile + USDC revenue share |
| `/inbox` | **Inbox — two tabs.** **Notifications** (default): newest-first (`from @username ✓ · via <jam> · text · relative time`), unread badge on the Inbox tab, "mark all read", **Open** button when a message carries a validated `link` (→ `/app/<slug>?d=…`); text rendered plain, never HTML. **Friends** (the old crew, now reachable here): add-once-play-everywhere list, each `@name ✓` + their ENS name, rows open a **chat thread** (jams/tips/links travel in-thread; a **💸 Pay a friend** button → amount + note → confirm sheet → money line, same ≤25 USDC cap) |

Confirm sheet (host-rendered, never inside iframe — **stays Toybox**, trust
boundary = a "🔒 superjam confirm" header chip + "asked for by `<jam>` — jams
never touch your wallet") states:
`review` (jam name + icon, human-readable summary: "Send 0.50 USDC to
tipjar.kris.superjam.fun", Approve/Reject) → `pending` (spinner + tx hash when
sent, ↗ Basescan) → `success | error`. Reject resolves the bridge call with
`USER_REJECTED`. Host-side hard cap: any single tx ≤ `25` USDC equivalent
(constant), reject above. The **only** wallet surface (a jam never draws money UI).

Flows:
- **Make:** idea → `builds.refine` (follow-ups) → plan → choose builder →
  `builds.create` → poll → reveal → open jam. Slug from manifest, under the
  owner's claimed name; server dedupes with `-2`, `-3` suffix on collision.
- **Iterate:** `builds.create({ prompt, appId })` → previous `app.tsx` source
  included in codegen context → same appId/slug/storage (data survives —
  load-bearing; websim's fresh-DB-per-version is the cautionary tale), version++.
- **Publish:** requires `worldVerified` → pay 1 USDC fee via confirm sheet →
  `publish.submit({ appId, txHash })` → status `listed` (appears in Discover).
- **Review:** on the jam page, requires `worldVerified` (the gate IS the
  feature: **one review per human per jam**, nullifier-backed — no
  astroturfing). `reviews.upsert({appId, rating, text?})` — UNIQUE(app,user)
  makes a second submit an edit. Gate copy: "Reviews are one-per-human.
  Verify to review."
- **Remix:** `apps.recipe({slug})` → pre-filled Make home →
  `builds.refine({prompt, remixOfAppId})` extends the base spec →
  `builds.create({spec, remixOfAppId})` → **NEW jam row** (new slug/owner,
  version 1, fresh storage — new appId scopes everything), `remixOfAppId`
  lineage, build seeded with parent `build.files` (same mechanism as Iterate).
  Remix **consumes a build** under the trial mechanic — copy: "Remixing is
  making. Verify to keep remixing."
- **Invite/share:** jam calls `sdk.share.link({data})` → host mints
  `https://<web>/app/<slug>?d=<payload>` locally (pure URL math, no server
  hop) → jam passes that url as `link` in `sdk.messages.send` → recipient's
  Inbox shows **Open** → lands in the jam with `launch` populated. Login
  wall preserves `?d=` through the redirect.
- **Pay a friend:** chat thread → 💸 → amount + note → confirm sheet →
  wallet-to-wallet USDC → money line in the thread (same cap + trust model).
- **Trial mechanic (World tracks):** every user gets **1 free build**;
  build #2+ (including remixes) AND publishing require World ID — the
  **first-jam gate** fires once. Copy: "Verify you're human to keep jamming."

---

## 3. Sponsor targeting (verified from live 2026 prize pages)

Full 2026 sponsor board: ENS 20K · Sui 15K · World 15K · Arc 15K · Hedera 15K ·
LI.FI 15K · Chainlink 14K · Uniswap 10K · Canton 10K · Ledger 10K · Dynamic 10K ·
GCloud 5K · Privy 5K · Unlink 5K · 1inch 5K · Blink 5K.

| Sponsor | Track | $ | What we must show |
|---|---|---|---|
| ENS | Best ENS Integration for AI Agents | $5K (2.5/1.5/1) | Agent mints subnames + records; marketplace reads from ENS; **implement ENSIP-25 + ENSIP-26 on `builder.superjam.eth`** (the prize page links both — §16); booth Sun AM in person |
| ENS | Most Creative Use of ENS | $5K (2.5/1.5/1) | Same build, second angle: the app store AS ENS records ("what else can ENS do — surprise us") — incl. **remix lineage on chain** (`app.remixOf` records form a provenance tree readable from ENS alone, §11/§16) |
| ENS | Integrate ENS pool | $6K split | Real ENS code, open source — qualifies automatically |
| World | AgentKit | $7.5K (3.5/2.5/1.5) | **Open marketplace of human-backed builder agents** (§14): registration gated on World-verify, paid per build in USDC, ENS-named under their human, verified-human reviews on their onchain 8004 reputation + trial mechanic |
| World | World ID | $2.5K | **Backend** proof validation (v4); World ID as real constraint ("what breaks without it": spam apps + fake leaderboards + remix/inbox spam + **astroturfed app reviews** from sybils — reviews are the most-botted surface on the internet; ours are one-per-verified-human) |
| Dynamic | Best Agentic Build | $2K | AI agent uses Dynamic **server wallets** to sign + execute onchain (ENS mint, ERC-8004 registration) |
| Dynamic | Best Overall Use | $2K | Embedded wallets, deployed + usable by judges |
| Sui | Best new build w/ Walrus | $3K | Mini-app bundles published to Walrus + blob id in ENS records; chain-agnostic, EVM-friendly; workshop Fri 3:30 PM |
| Dynamic | Best Private Nanopayments App (w/ Unlink, on Arc testnet) | $2K + $1K bonus | tips private BY DEFAULT (§15) = Dynamic+Unlink+Arc; the gated `sdk.payments.payX402` (Circle Gateway/x402) adds the 4th tech for the full combo (presumptive slot-3, §3) |
| Arc | Chain Abstracted USDC (stretch, rules-gated) | $3.25K | Only if >3 sponsor submissions allowed |

Booth scripts + reaction reads per sponsor: **docs/PITCH.md**.

**Track picks — 3 sponsors max, one track per sponsor. Slots 1+2 firm,
slot 3 OPEN (decide by Fri eve, after the Walrus workshop):**

1. **ENS → Best ENS Integration for AI Agents** ($5K, 1st $2.5K). Most
   differentiated: ENSIP-25/26 implemented + agent-minted app catalog. Most
   Creative is the fallback angle inside the same submission.
2. **World → AgentKit** ($7.5K, 1st $3.5K — biggest single track we fit).
   Trial mechanic + human-backed builder. World ID backend-verify is a strict
   subset, so their World ID track is the zero-cost fallback.
3. **Slot 3 = Dynamic/Nanopayments combo — now PRESUMPTIVE (decision
   2026-06-13).** Confidential tips are core product (§15: ALL peer-to-peer
   tips are Unlink private transfers on Arc testnet by default), so the
   submission's marginal cost is just the diagram + video — not new build
   work. **Two surfaces, by privacy pattern** (Unlink's guide uses both):
   (a) **private tips** = the `transfer` primitive (private→private), ALWAYS
   ON, covers **3 of the 4** techs — Dynamic + Unlink + Arc; (b) **`sdk.payments.payX402`**
   = `withdraw → Circle Gateway pay(url)` (private→x402 resource), the GATED
   prize-complete leg that adds the **4th tech, Circle Gateway/x402**, so one
   call exercises all four (§9/§15). The reference architecture uses
   `@circle-fin/x402-batching`, so plan to show payX402; but the booth question
   stays — **if Circle counts Arc+USDC as the "Circle" leg, tips alone (a) win
   it and payX402 is pure upside.** "Decide from evidence": the **Thu Unlink
   rehearsal (§23) is the gate** — fail ⇒ tips fall back to public (§15),
   payX402 is cut, slot 3 reverts to a fallback below.
   - **Dynamic+Unlink+Arc (the pick):** $2K + $1K runner-up (+ Unlink's separate
     $1.5K "add privacy to what you're building" continuity track), and one
     submission may read as 3-sponsor coverage (confirm at kickoff whether
     Arc/Unlink count it too). NOTE the 1-track-per-sponsor rule means this
     forfeits Dynamic's Agentic Build — but the server-wallet baseline keeps
     Agentic Build as the zero-cost fallback if this lane dies. **Verified
     2026-06-13 (docs.unlink.xyz):** SDK `@unlink-xyz/sdk@canary` (churn risk);
     Zcash-style shielded pool (Groth16); private transfers + withdrawals
     are RELAYED by Unlink — sender pays no gas; testnet faucet
     `client.faucet.requestPrivateTokens()` mints straight into the private
     balance, skipping the public deposit step (demo gold). Recipient needs
     a registered `unlink1…` account → platform registers at World-verify,
     stores the address on the user row, resolves @username → unlink1.
     Both Unlink AND Arc are **testnet-only** (no mainnet exists for either) —
     which (with the rest of the app, §15.1) is why the whole event runs on
     testnet. Their partner guide IS this exact combo (Dynamic+Unlink+Circle+
     Arc) but adds a Circle Gateway/x402 leg — confirm at booth whether
     Arc-as-chain alone satisfies the "all three technologies" rule. Honest
     effort ≈1-1.5 days. Booth asks (§23): recipient note-discovery latency;
     key derivation (`account.fromEthereumSignature` needs Dynamic's TSS-MPC
     `personal_sign` to be deterministic — else the partner-guide
     mnemonic-in-Unlink-userStorage path, which forces a passphrase/
     WebAuthn unlock UX).
   - **Fallbacks if the Unlink rehearsal fails** (tips revert to public):
   - **Ledger — "AI Agents x Ledger"** ($10K, FIVE winners: 3/2.5/2/1.5/1K —
     best odds on the board). Build: Ledger device as the human-in-the-loop
     control layer for the builder agent — privileged agent actions (testnet
     ENS mint batch, treasury ops) require operator approval on the device;
     completes the trust hierarchy (verified humans → host confirm sheet →
     device-secured operator). + mandatory docs feedback w/ screenshots (free
     points). ≈3-5h. **Gated on: owning/bringing a physical Ledger.**
   - **Sui/Walrus** — publish each bundle to Walrus after S3, blob id in the
     app's ENS records, "stored on Walrus" badge + aggregator link; completes
     kill-our-infra-apps-survive. ≈2-3h. $3K (likely single winner). Gauge
     publisher friction at Fri 3:30 PM workshop.
   - **Hedera — AI & Agentic Payments** ($6K, 2×$3K). Build: agent
     autonomously pays a build fee on Hedera testnet + HCS audit-trail message
     of each build hash; their bonus list literally names ERC-8004 + x402,
     both already in our stack. ≈3-5h; weakest "why this chain" story.
   - **Dynamic/Agentic Build** ($2K single). Re-add the server-wallet adapter
     (≈2-3h). Safest, smallest; we use their embedded wallets regardless.
   - **Arc/Chain-Abstracted USDC** ($2.15K). Arc port + CCTP hop, ≈4-6h. Most
     work for least money.
   - **Unlink standalone** ($1.5K continuity track): auto-qualified once the
     private-tip rail ships (§15) — additive to the combo, zero extra work.
   - **LI.FI** ($15K pool, tracks unknown — prize subpage 404s): only coherent
     idea is fund-wallet-from-any-chain. Check tracks at kickoff.

Baseline (changed 2026-06-13): agent wallet = **Dynamic server wallet**
(TSS-MPC via `DYNAMIC_API_TOKEN`, §1) — no raw key, and it makes the Dynamic
"Best Agentic Build" submission near-free ('give AI agents wallets' is
literally our §11 step 5). 1-track-per-sponsor: picking Nanopayments forfeits
Agentic Build — but the server-wallet baseline keeps Agentic Build as the
zero-cost fallback either way. USER payments are **gasless via USDC-native
EIP-3009** (`transferWithAuthorization`, §15.1): the user signs an off-chain
authorization, our server wallet relays it and pays the ETH — no paymaster,
no bundler, no smart-account, no ZeroDev. Strengthens Dynamic (clean
signed-auth UX) AND the Circle/USDC story. (The agent server wallet runs on
pre-funded ETH; it pays all ENS/8004 gas + relays user payments.)
**The stack, one line per sponsor:** ENS = names (users, apps, agents) ·
World = humans (identity, anti-sybil, human-backed agents) · Dynamic =
wallets (embedded for users, server wallets for agents) · Arc+Unlink =
the PRIVATE payments lane (nanopayments track) — and tips are private by
DEFAULT, not a side feature (§15). Base Sepolia USDC is the public rail
(publish/stake/paid-build, which the platform must verify on-chain); Arc
testnet is the private tip rail; the two are split by the §15 rule, never
"ported" into each other mid-event. Everything is testnet (§15.1).
Five sponsors total, pending the kickoff submissions-cap check.
Economics v1: agent build price → 100% to the agent's wallet (platform
revenue = the 1 USDC publish fee); platform % cut + tip royalties =
Q&A roadmap. Through-line regardless: builder agents are human-backed
(AgentKit), onchain (ERC-8004 identity + reputation), named + discoverable
(ENSIP-25/26), and their outputs are named on ENS and paid in USDC. ENS's $6K Integrate pool may be
additive (confirm at booth, zero extra work). Arc/limo as stretches only if
rules allow >3 sponsor submissions — else Sat eve = polish + gallery seeding.

Skipped, with reasons: **Blink** (deposit onramp — we pre-fund demo wallets;
adds an integration + a manual merchant-approval dependency for a feature the
demo doesn't need); Privy (Dynamic covers agent wallets); Hedera / Canton
(different chains, would fragment); LI.FI / Uniswap / 1inch (swap- and
bridge-specific); Chainlink (no natural fit; VRF-for-games is a rabbit hole);
Ledger (our pitch is invisible-wallet UX); GCloud (BigQuery analytics track —
different project). Sui's $12K Walrus track is continuity-only; only the $3K
new-build track is ours. **Unlink: unknown — check at kickoff.**

⚠️ Kickoff checks: (a) rumored "max 3 sponsor SDKs" rule; (b) pre-event infra
(ENS name, Durin registry, accounts) kosher — worst case Durin wiring is 2 txs/10 min live;
(c) what Unlink is.
**Submission: Sun Jun 14, 09:00 EDT hard stop. Judging: 4 min demo + 3 min Q&A.**

---

## 4. Monorepo layout + stack

Repo `superjam` (new, **public**). Bun workspaces + Turborepo, `catalog:` pins.

```
apps/
  web/          Next.js 16 host shell (§2) + host bridge lib
  server/       Bun + Hono + oRPC: everything backend (§12) + bundle serving
  gateway/      Caddy (§17)
packages/
  sdk/          @superjam/sdk — child-side bridge client + SDK.md (docs ⇒ codegen prompt)
  api/          oRPC routers + context (server imports impl; web imports types)
  db/           Drizzle schema + migrations (Postgres 17)
  shared/       SERVICE_URLS, env schema, typeid prefixes, capabilities, constants,
                bridge envelope zod schemas
  onchain/      viem chains, USDC helpers, Durin mint/read, agent wallet adapter
  builder/      codegen + bundle + upload + register pipeline
  app-template/ the ONE mini-app template + examples/ (fixtures + few-shots)
  logger/       thin pino wrapper (sonara shape)
```

**Pins** (bump patch at kickoff): Bun 1.3.x · Turbo 2.9 · Hono 4.12 · oRPC 1.14
(`@orpc/server,client,zod,tanstack-query`) · Drizzle 0.45 + drizzle-kit 0.31 +
drizzle-zod · Zod 4.4 · typeid-js 1.2 · Next 16.2 · React 19.2 · Tailwind 4 (shell
only) · @base-ui/react 1.4 · TanStack Query 5.10x · viem 2.31+ · `ai` v6 +
`@ai-sdk/anthropic` · Dynamic **new `@dynamic-labs-sdk/*` namespace** (+
`@dynamic-labs-wallet/node-evm`) · `@worldcoin/idkit` v4 (+ `@worldcoin/agentkit`)
· jose (JWKS) · oxlint/ultracite + tsgo · bun test + pglite (`@electric-sql/pglite`)
· mini-app template only (§10): three 0.182 + `@react-three/fiber` 9 +
`@react-three/drei` 10 + recharts 3 + motion 12 + canvas-confetti +
react-qr-code + papaparse.

**House patterns — lift shapes from (absolute paths on THIS box; for the
spec-implementing agent, NOT the mini-app builder — that one only ever sees
SDK.md + skills):**

| Pattern | Lift from |
|---|---|
| typeid (branded ids, zod validator, uuid storage) | `~/code/appmisha/packages/shared/src/typeid.ts` |
| drizzle typeId column + `baseEntityFields` | `~/code/appmisha/apps/api/src/db/utils/db-utils.ts` |
| schema org (`{feature}.db.ts` per domain) | `~/code/appmisha/apps/api/src/db/schema/` |
| service factory (`createXService({deps})` → object) | `~/code/appmisha/apps/api/src/features/public/public-store-service.ts` |
| pglite test infra (per-test db + migrations) | `~/code/appmisha/packages/test-utils/src/pg-lite.ts`, `pg-drizzle.ts` + `~/code/appmisha/apps/api/test/test.setup.ts` |
| row factories (`createTestUser(db, overrides?)`) | `~/code/sonara/packages/test-utils/src/factories.ts` |
| DI for tests: inject deps via context/factory args — never module-mock | (the factory + test.setup patterns above) |
| typed errors: `commonErrors` ErrorMap + neverthrow `Result` + `unwrapOrThrow` | `~/code/invok/packages/shared/src/errors.ts` + `~/code/appmisha/apps/api/src/lib/service-error.ts` |
| oRPC context + procedure builders w/ middleware chain | `~/code/appmisha/apps/api/src/lib/orpc.ts` + `orpc-router.ts` |
| Next: RPCLink (window-origin/internal split) + `createTanstackQueryUtils` | `~/code/appmisha/apps/frontend/src/lib/orpc-client.ts` |

Checks: `bun run typecheck && bun run lint && bun test && bun run build` = the gate.
`docker-compose.yml` at root: postgres:17 + minio (ports in the 47xx block).

---

## 5. Environments & config

House pattern: single `APP_ENV` (server, required, no default) /
`NEXT_PUBLIC_APP_ENV` (web build arg) → `SERVICE_URLS` in `packages/shared`:

```ts
export const ENVIRONMENTS = ["local", "dev", "prod"] as const;
export const SERVICE_URLS: Record<Environment, ServiceUrls> = {
  local: { web: "http://localhost:4700", apiInternal: "http://localhost:4701",
           appsOrigin: "http://localhost:4701", cookieDomain: "localhost",
           builder: "http://localhost:4710" },   // usually unused: local => BUILDER_MODE=agent in-process
  dev:   { web: "https://dev.superjam.fun",
           apiInternal: "http://server.railway.internal:4701",
           appsOrigin: "https://apps-dev.superjam.fun", cookieDomain: "dev.superjam.fun",
           builder: "https://builder.superjam.fun" },  // the dev-box VPS (§11) — serves both envs
  prod:  { web: "https://superjam.fun",
           apiInternal: "http://server.railway.internal:4701",
           appsOrigin: "https://apps.superjam.fun", cookieDomain: "superjam.fun",
           builder: "https://builder.superjam.fun" },
};
export const chainForEnv = () => "baseSepolia";  // testnet-only event
  // posture (§15.1); mainnet = a post-event config flip. Privacy rail is
  // always Arc testnet (§15); ENS L1 is Sepolia.
```
Ports: web 4700, server 4701, builder 4710 (dev-box only), pg 47432, minio 47900/47901.
Server env zod-validated fail-fast in `apps/server/src/env.ts` (vars per §1 +
mode flags below). Web env parsed in `apps/web/src/env.ts`.

### 5.1 Mode flags (trimmed 2026-06-13 — core integrations always live; testnet-only posture means no chain flag, §15.1)

| Flag | Values (default) | Behavior |
|---|---|---|
| `BUILDER_MODE` | `remote` (default everywhere) \| `agent` \| `oneshot` | remote: POST the spec to the dev-box builder service (bearer `BUILDER_TOKEN`), mirror its events, pull the artifact → S3 (§11). agent: the same Agent SDK session in-process — debugging the loop locally. oneshot: single generateText + one repair — break-glass if the builder VPS dies |

Dynamic auth, Gemini refine, World verify, and ENS mint have NO off/mock
modes — creds are present from kickoff (§0.2). One resilience rule survives:
**ENS mint failure must not fail a build** (§11 step 5 — done + null ensName
+ retry on /manage). Walrus: cut from the build spec (Sui remains a §3
slot-3 *strategy* option; if chosen, spec the publish step that evening).

---

## 6. Architecture + trust model

```
 superjam.fun ───▶ gateway (Caddy) ── /rpc/* /api/* ─▶ server ──▶ Postgres / S3
 apps.superjam.fun ─▶ gateway ── host match ─▶ server /a/*        │
                      else ─▶ web (Next16)                        ▼
        web: Dynamic login · marketplace · confirm sheet     Base via viem:
             └─ <iframe sandbox> mini app (@superjam/sdk)    Durin L2Registry,
                  ▲ bridge postMessage envelope (§8)         USDC, agent wallet
                  └ host bridge: capability check → confirm sheet → oRPC

 builder.superjam.fun (kristjan-dev VPS) ◀── Bearer BUILDER_TOKEN ── server builds.create
        Caddy TLS ─▶ apps/builder :4710 ─▶ Claude Agent SDK (subscription `claude`)
        POST /builds · GET /builds/:id events · GET /builds/:id/artifact ──▶ platform pulls → S3
```

Non-negotiables:
- iframe: `<iframe sandbox="allow-scripts allow-forms" allow="" referrerpolicy="no-referrer">`
  — **no `allow-same-origin`** ⇒ opaque origin: no cookies/localStorage/parent
  DOM. Plus separate apps origin = defense in depth.
- Mini app never signs; never sees keys, JWTs, or other apps' data. All
  capability flows through the bridge; the **host** renders confirmation UI
  (Dynamic's own popup toggled OFF in dashboard so our sheet is the only UI).
- Capabilities: app manifest declares `capabilities: ("payments"|"ai"|"social")[]`.
  `payments` gates `wallet.sendTransaction` + `payments.*`; `ai` gates
  `ai.chat` (cost-bearing); `social` gates `messages.send` (user-to-user push —
  the spam-bearing capability). `storage`/`data`/`profile`/`ui`/`messages.list`/
  `share.link` are implicit. Bridge rejects (`FORBIDDEN_CAPABILITY`) before any UI.
- Server stamps identity on every storage/data write — iframe-supplied identity
  never trusted. The bridge procedures take `appId` from the host's session map,
  never from the child message.
- Bridge rate limit: 20 calls/s per (app,user), token bucket host-side → `RATE_LIMITED`.
- Deeplink `launch` payloads (§2 `?d=`) are attacker-controlled input forwarded
  verbatim to the app: the host never acts on `d` itself (only zod-Json + size
  cap; parse defensively — null-prototype, reject `__proto__`/`constructor`
  keys); the confirm sheet + TX cap remain the backstop against payloads that
  pre-fill payments. Inbox `link`s are validated platform-origin
  `/app/<slug>[?d=…]` only — no external URLs behind an Open button.
- The builder VPS is an *executor*, not a trust root: no platform credentials,
  no DB/S3 access, no user data — spec in, artifact out, token-gated. The
  platform zod-validates the returned manifest and owns every write. Builder
  down ⇒ building degrades (`BUILDER_MODE=oneshot`); published apps unaffected.

---

## 7. Database schema (Drizzle, Postgres)

House conventions: TypeID prefixed ids (custom column type + `$defaultFn`),
`baseEntityFields` (createdAt/updatedAt timestamptz, `$onUpdate`), drizzle-kit
SQL migrations committed + run on server boot.

Prefixes: `user→usr, app→app, build→bld, record→rec, publishPayment→pub, review→rvw, message→msg, builderAgent→bag`.

```ts
user:           id, ensName nullable (username.superjam.eth, §11/§14),
                dynamicUserId text unique nullable, email unique, username
                (email prefix, deduped), walletAddress, worldVerified bool def false,
                worldNullifierHash unique nullable, freeBuildsUsed int def 0,
                unlinkAddress text nullable (the user's unlink1… private-payment
                account, §15), lastTopupAt timestamptz nullable (§15.1 top-up), base
app:            id, slug unique /^[a-z0-9-]{3,32}$/, name, description, iconEmoji,
                category text def 'other' (game|social|tool|creative|other),
                remixOfAppId nullable→app (lineage; every remix = NEW row),
                ownerUserId→user, status enum(building|deployed|listed|delisted),
                capabilities jsonb string[], bundleKey, version int def 1,
                treasuryAddress, ensName nullable, ensTxHash nullable,
                ipfsCid nullable, currentBuildId nullable,
                builtByAgentId nullable→builder_agent, base
build:          id, appId nullable→app, userId→user, agentId nullable→builder_agent,
                prompt text (raw idea),
                spec jsonb (the refined AppSpec), status enum(
                queued|generating|bundling|uploading|registering|done|failed),
                error text nullable, files jsonb nullable (path→source snapshot),
                events jsonb (activity feed, cap 100), manifest jsonb,
                model text, durationMs int, costUsd text nullable, base
app_storage:    appId, userId, key varchar(128), value jsonb, updatedAt,
                PK(appId,userId,key)
app_record:     id rec, appId, collection varchar(64), userId, username,
                worldVerified bool, data jsonb, base,
                index (appId, collection, createdAt desc)
app_counter:    appId, counter varchar(64), key varchar(128), value bigint def 0,
                PK(appId,counter,key), index (appId, counter, value desc)
publish_payment: id, appId, userId, txHash unique, chainId int, amountUsdc text,
                status enum(pending|confirmed|rejected), base
app_review:     id rvw, appId→app, userId→user, rating int (1–5 check),
                text varchar(280) nullable, base,
                UNIQUE(appId, userId)  -- one review per human per app; upsert = edit
pot:            id pot, appId→app, creatorUserId→user, question, options jsonb
                string[] (2-6), status enum(open|resolved|void),
                resolvedOption nullable, deadline nullable, base
pot_stake:      potId→pot, userId→user, option, amountUsdc text, txHash unique,
                paidOutTxHash nullable, base
builder_agent:  id bag, ownerUserId→user, name, slug unique, endpointUrl,
                token (bearer the platform sends), priceUsdc text def "0",
                walletAddress (payout), ensName nullable, buildsCount int def 0,
                status enum(active|disabled), base
app_message:    id msg, appId→app, fromUserId→user, toUserId→user,
                text varchar(280), data jsonb nullable (≤1KiB serialized),
                link text nullable (validated relative /app/<slug>[?d=…] path),
                read bool def false, base, index (toUserId, createdAt desc)
```

Constants (`packages/shared/constants.ts`): KV ≤1000 keys/user/app, value ≤64KiB
(serialized), records ≤10_000/app, doc ≤64KiB, names `[A-Za-z0-9_-]{1,64}`,
key `[A-Za-z0-9_-]{1,128}`, FREE_BUILDS=1, PUBLISH_FEE_USDC="1", TX_CAP_USDC="25",
LIST_MAX=100, AI_CALLS_PER_USER_APP_DAY=25, AI_MAX_OUTPUT_TOKENS=1000,
AI_APP_MODEL="claude-haiku-4-5" (in-app + refine; build agent uses fable),
REFINE_CALLS_PER_USER_DAY=20,
CATEGORIES=["game","social","tool","creative","other"], REVIEW_TEXT_MAX=280,
MSG_TEXT_MAX=280,
MSG_DATA_MAX_BYTES=1024, INBOX_CAP=200 (evict oldest READ first),
MSG_PER_PAIR_PER_MIN=5, MSG_PER_SENDER_PER_MIN=20 (PoC-proven caps),
DEEPLINK_MAX_CHARS=2730 (base64url of ≤2KiB JSON), SIMILAR_MAX=3,
BUILD_ATTACH_MAX=4, ATTACH_MAX_MB=2, AGENT_PRICE_MAX_USDC="5", POT_STAKE_MAX_USDC="10", POT_TOTAL_MAX_USDC="100",
TOPUP_USDC="5", TOPUP_PER_HUMAN_PER_DAY=1 (§15.1 top-up — World-gated faucet),
X402_MAX_USDC="2", X402_CALLS_PER_USER_APP_DAY=10, X402_ALLOWED_HOSTS=string[]
(payX402 egress allowlist, §9 — host pays only these),
PLAYS_COUNTER="_plays". Quota breach ⇒
typed `QuotaExceededError`. AI call counting: cheap daily counter row keyed
(appId, userId, date) — reuse `app_counter` with reserved name `_ai_quota`
(and `_x402_quota` for payX402 the same way).
Play counts reuse `app_counter` the same way, reserved counter `_plays`: the
`/a/:slug/` index.html handler (§17) increments keys `total` and `<yyyy-mm-dd>`
on every serve (index.html is no-cache ⇒ one bump per viewer load, zero client
work). Explore sort: Trending = today+yesterday sum, Top = `total`.

---

## 8. Bridge protocol (hand-rolled — the security boundary, fully specified)

No penpal: the boundary must have zero unspecified library behavior with opaque
origins. (≈150 lines/side; zod schemas in `packages/shared/bridge.schema.ts`.)

> ⚑ PoC reference implementation (2026-06-12, working live): a slim version of
> this whole stack — child SDK with standalone mock fallback
> (`~/code/turbojam-poc/packages/app-template/src/sdk.ts`), host bridge +
> confirm sheet (`apps/web/src/components/app-frame.tsx`), platform
> capability endpoints (`apps/server/src/bridge.ts`), and the SDK.md skill
> file the build agent reads (`packages/app-template/SDK.md`). The agent used
> storage/leaderboard/social/payments — and later the same day shared
> collections (`sdk.data`, the §9 data surface: server-stamped docs,
> author-only delete) and a **one-way messages primitive**
> (`sdk.messages.send({to, text, data?})` → recipient-side inbox + host
> /inbox page + per-pair rate caps) — correctly on first builds, learned
> purely from SDK.md. Messages are now CORE §9 (promoted on this evidence) —
> backed by Postgres `app_message` (§7) in the real build, not the PoC's
> bucket JSON; keep the PoC's per-pair/per-sender caps and the read
> circuit-breaker verbatim. Also PoC-proven
> (2026-06-12 evening): **sdk.ai** (text / json / app-declared tool-calls —
> per-mode forced answer schemas on the builder, tool names enum-locked,
> exact-match cache, per-user+global daily quotas), **sdk.ai.image** (fal
> flux klein ≈$0.0035/img, bucket-persisted global money cap, 4-concurrent
> gate) and **sdk.files.upload** (magic-byte sniffed jpeg/png/webp/gif — NO
> SVG ever; served at /f/ with nosniff + `CSP: default-src 'none'; sandbox`
> + immutable). Validation: agent built an AI-trivia app (ai.json) and an
> AI-postcard gallery (ai.image + shared collection) correctly first-try.
> Video rejected: minutes-long generation breaks the 60s bridge timeout —
> needs an async-job pattern, not a quick add. PoC-proven hardening
> to keep: CSP `script-src 'self'` on the apps origin (without it, one app
> rendering another user's text via dangerouslySetInnerHTML hands the
> injected script full bridge access as the victim), safeParse→readable 400s
> on bridge endpoints (LLM apps send bad params), and a per-user read
> circuit-breaker (a bad useEffect polls in a tight loop).
> Lift shapes from there; this section stays the authoritative contract.

Envelope (child → parent via `window.parent.postMessage(msg, "*")` — `"*"` is
forced by opaque origin and safe: requests carry no secrets and replies are
addressed to a specific `Window`):

```ts
type TJRequest  = { tj: 1, id: string /*nanoid*/, method: string, params: unknown }
type TJResponse = { tj: 1, id: string, ok: true,  result: unknown }
                | { tj: 1, id: string, ok: false, error: { code: TJErrorCode, message: string } }
type TJErrorCode = "UNAUTHORIZED" | "FORBIDDEN_CAPABILITY" | "QUOTA_EXCEEDED"
                 | "USER_REJECTED" | "STANDALONE" | "RATE_LIMITED"
                 | "BAD_REQUEST" | "INTERNAL"
// parent → child, unsolicited (stretch S1 realtime):
type TJEvent    = { tj: 1, event: "data.changed", data: { collection: string } }
```

Parent (host bridge lib in `apps/web`): ONE `window.addEventListener("message")`;
resolve the calling app via `event.source` against a
`Map<Window, { appId, slug, capabilities, iframeEl }>` registered when the
viewer mounts the iframe; ignore messages whose source isn't registered; zod-
parse envelope; rate-limit; capability-check; dispatch; reply with
`iframeEl.contentWindow.postMessage(resp, "*")`.

Child (`@superjam/sdk`): post `{ method: "host.hello" }` on connect, retry every
250ms; parent replies with the app context. **No reply within 5s ⇒ standalone
mode**: `sdk.standalone === true`, all methods reject with `STANDALONE`, and the
template shows an "Open in SuperJam" banner. (This is what makes IPFS/.limo
serving safe — bundles must use relative asset paths.)

Method strings (flat): `host.hello`, `app.context`, `wallet.getAddress`,
`wallet.sendTransaction`, `payments.payUSDC`, `payments.usdcBalance`, `payments.payX402` (gated, §9),
`storage.get|getMany|set|delete|clear|list`, `data.insert|get|update|delete|list`,
`counter.increment|top`, `ai.chat`, `payments.mine`, `pot.create|stake|get|resolve`,
`messages.send|list`, `share.link`,
`ui.toast` (+ stretch S1: `data.subscribe|unsubscribe`).
The `app.context` reply carries the viewer's `launch` deeplink payload (§2/§9);
`share.link` is resolved **host-side** (pure URL construction, no oRPC hop).

---

## 9. `@superjam/sdk` contract

```ts
const sdk = await SuperJam.connect();   // resolves in standalone mode too

sdk.app.context() → { appId, slug, name, ensName, category,
                      remixOf: { slug, name } | null,
                      launch: Json | null,    // ?d= deeplink payload — UNTRUSTED input
                      user: { id, username, walletAddress, worldVerified } }
sdk.wallet.getAddress() → `0x…`
sdk.wallet.sendTransaction({ to, value?, data?, chainId? }) → { hash }  // confirm sheet
sdk.payments.payUSDC({ amount /*decimal string*/, to? }) → { hash }     // to defaults to app treasury
  // PRIVATE BY DEFAULT (§15): a tip/pay-action is an Unlink shielded transfer
  // on Arc testnet (relayed, gasless); `to` is a @username → host resolves
  // user.unlinkAddress. Falls back to a public Base Sepolia transfer only if
  // the privacy rail is unavailable. Never promise public proof of a payment.
sdk.payments.usdcBalance() → { formatted, raw }  // spendable (private/Arc) balance
sdk.payments.mine() → { payments: [{ to, amountUsdc, memo, txHash, at }] }
  // server-verified list of THIS user's confirm-sheet payments in THIS app.
  // The ONLY trustworthy unlock/paywall check — NEVER gate premium content
  // on an sdk.storage flag (the client can set it without paying).
sdk.payments.payX402({ url, maxAmount? }) → { paid, result? }   // (GATED, §3/§15)
  // private PAY-PER-CALL nanopayment to an x402 (HTTP-402) paywalled resource:
  // host-proxied (the iframe never fetches — §8 CSP), allowlisted host only
  // (X402_ALLOWED_HOSTS), maxAmount ≤ X402_MAX_USDC, daily-quota'd. Mechanism:
  // user's Unlink balance → withdraw to a platform payer EOA → Circle Gateway
  // (@circle-fin/x402-batching) deposit + pay(url) on Arc → returns the
  // resource body. Unlinkable from the funding wallet. THE Dynamic+Unlink+
  // Circle+Arc combo (§3). Use for premium/per-call resources; NEVER for
  // user-to-user value (that's payUSDC). Requires capability "payments".

sdk.storage.get(key) → Json | null               // user-private KV; null, never throws
sdk.storage.getMany(keys) → Record<string, Json|null>   // batch — RTT matters
sdk.storage.set(key, value) / delete(key) / clear()
sdk.storage.list({ prefix?, limit?, cursor? }) → { keys, cursor? }

sdk.data.collection(name).insert(doc) → { id, createdAt }     // shared, app-scoped
sdk.data.collection(name).get(id) → Doc | null
sdk.data.collection(name).update(id, patch) / delete(id)      // OWN rows only
sdk.data.collection(name).list({ where?, orderBy?, limit?, cursor? }) → { docs, cursor? }
  // Doc = { id, userId, username, worldVerified, createdAt, data } — identity server-stamped
  // where: top-level equality only, ≤3 keys (jsonb @> containment)
  // orderBy: { field: "createdAt" } | { field: <numeric data field>, dir } — numeric cast, NULLS LAST

sdk.data.counter(name).increment(key, by = 1) → number   // atomic upsert
sdk.data.counter(name).top(limit = 10) → { key, value }[] // THE leaderboard primitive

sdk.ai.chat(messages /*{role:"user"|"assistant"|"system",content:string}[]*/,
            opts?: { json?: boolean, images?: string[] }) → { text }
  // images: /f/ URLs or dataURLs, ≤2MB each, ≤4/call — platform fetches the
  // bytes and calls Gemini flash MULTIMODAL; same quotas. Unlocks AI JUDGING:
  // grade drawings/outfits/photos against a rubric YOU state — never identity
  // traits of people; always show the score AND the AI's one-line reasoning.
  // host-proxied LLM (haiku-class, pinned server-side), keys never reach the app;
  // quota'd per user/app — the Quick move: generated apps are themselves AI-powered

sdk.messages.send({ to /*username*/, text /*≤280*/, data?, link? }) → { id }
  // one-way notify/invite — recipient sees it in the host /inbox (unread badge).
  // link must come from sdk.share.link (host validates platform-origin
  // /app/<slug>[?d=…] only — inbox renders it as an Open button). Requires
  // manifest capability "social". Caps: 5/min per (sender,recipient) pair,
  // 20/min per sender.
sdk.messages.list({ limit? = 50 }) → { messages }   // sent TO me via THIS app, newest-first
  // Message = { id, from /*username*/, text, data, link, createdAt, read }
sdk.share.link({ data? }) → { url }    // deeplink to THIS app (host-side URL math);
  // data ≤2KiB JSON, delivered to whoever opens the url as sdk.app.context().launch

sdk.files.upload(dataUrl) → { id, url }   // user images: jpeg/png/webp/gif ≤2MB,
  // magic-byte sniffed server-side, served from /f/ (nosniff + sandboxed CSP).
  // Camera = <input type=file accept="image/*" capture="environment"> (works in
  // the sandbox; getUserMedia does NOT — opaque origin). Screenshot/share-card =
  // render to <canvas> → toDataURL → upload.

sdk.pot.create({ question, options /*2-6 strings*/, deadline?,
                 resolver? /*"creator"(default)|"ai"*/ }) → { id }
  // escrowed social wager; creator must be worldVerified.
  // resolver:"ai" ⇒ at the deadline the PLATFORM resolves it from live data
  // (Gemini + search grounding) and auto-pays — see §11. Creator can always
  // override an ai-pot by calling resolve() themselves.
sdk.pot.stake({ id, option, amount /*≤10 USDC*/ }) → { txHash }
  // confirm sheet → USDC to the PLATFORM ESCROW (the agent's Dynamic server
  // wallet); pot total capped 100 USDC
sdk.pot.get({ id }) → { question, options, totals, myStake, status, resolvedOption }
sdk.pot.resolve({ id, option })   // CREATOR only (worldVerified) — platform pays
  // winners pro-rata FROM the agent wallet + inbox message "you won X USDC 🎉";
  // unresolved deadline+48h ⇒ void = full refunds. Gated by "payments".

sdk.ui.toast(message)                                      // host-rendered

// stretch S1: sdk.data.collection(name).subscribe(cb) / unsubscribe()
// (host holds one WS to server; in-process pub/sub broadcasts {appId, collection}
//  on writes; host forwards as TJEvent; SDK re-lists on event. Polling = fallback.)
```

Doc rules (these go in `SDK.md` verbatim — they are LLM guidance):
`storage` = user-private (saves, settings); `data` = app-public, every user can
read — never put secrets there; counters for scores/votes (atomic — never
read-modify-write); leaderboard = `counter("scores").top(10)`; all methods
async; batch reads with `getMany`; `payUSDC` is PRIVATE by default — never
promise a user public proof of a tip; social visibility of a payment comes
only from a `counter` the user opts into by tapping (e.g. a tips leaderboard),
never from the chain; `payX402` (if available) pays a premium per-call resource
privately — use it to UNLOCK paid content, never for tipping a person; always
gate the unlock on `payments.mine`, never a storage flag; `ai.chat` is for flavor/judging/summarizing
features — quota'd (25 calls/user/day), keep prompts short, never block first
render on it; `messages` = notify/invite ONE user (tip received, challenge a
friend) — never chat (use `data` for shared state); `to` is a username, never a
wallet; send AFTER the triggering action succeeds, in its own try/catch;
`ctx.launch` is untrusted input from a link — validate every field, render as
plain text, never auto-trigger payments from it; invite pattern:
`const {url} = await sdk.share.link({data:{matchId}});
await sdk.messages.send({to, text:"…challenged you!", link:url})`.
Recipes (existing primitives, no new surface): **secret dealing** (werewolf
roles, hidden hands) — `messages.send({to, data})` is recipient-private, so
deal secrets in `data` (NEVER `text`, which shows in the inbox); **unique
draw** (sweepstakes, "pick a team") — `counter("draw").increment(...)` is
atomic+sequential, index it into your option list for collision-free
assignment; **commit-reveal** (battleship, simultaneous answers) — publish a
hash of secret+salt to a shared doc at start, reveal at end, peers verify
client-side. **Paywalls/premium**: gate ONLY on `payments.mine()` (server-
verified) — never on a storage flag (spoofable). **AI judging**: grade
ARTIFACTS (drawings, outfits, photos) against a rubric YOU state — never
identity traits of a person; wholesome prompts only; always show the score
AND the model's one-line reason.

**`packages/sdk/SDK.md` is the single source of truth**: human docs AND the
codegen system prompt source. Write it as part of M3, from this section.

---

## 10. Mini-app template (`packages/app-template`)

```
index.html      fixed — <div id="root">, relative paths ONLY (IPFS-safe),
                <script type="module" src="./main.js">
src/main.tsx    fixed — SuperJam.connect(), standalone banner, error boundary
                (catches render errors → friendly "app crashed" card), mounts App,
                passes { sdk, ctx } as props
src/app.tsx     ★ GENERATED — `export default function App({ sdk, ctx })`
src/theme.css   fixed — **Toybox (light) default** (cream paper, ink outlines,
                sticker shadows, Baloo 2); CSS vars --bg --card --text --muted
                --accent --danger --radius; classes: tj-card tj-btn tj-btn-primary
                tj-btn-ghost tj-input tj-list tj-row tj-stat tj-badge tj-title
                tj-sub tj-muted tj-grid2 tj-center tj-spin tj-empty
                + game classes: tj-stage (full-bleed) tj-hud tj-pop tj-shake
src/lib/sfx.ts  fixed — SYNTHESIZED WebAudio sfx (click/pop/win/lose/boom) —
                zero audio assets by design
src/lib/game.ts fixed — useRaf (dt-seconds loop), useKeys, rand/randInt/pick/
                clamp/lerp, aabb collision
assets/         seeded empty — the generate_image tool (§11) writes here;
                copied verbatim into dist (ships with the bundle)
skills/         THE SKILL REGISTRY — per-framework recipe files; refine
                selects ≤3 (AppSpec.skills, zod-enum'd), the build prompt
                loads exactly those. Each = dep table + HARD RULES + ONE
                full worked exemplar + juice checklist (the format that
                made haiku nail r3f first-try):
  INDEX.md      one-liners (agent's self-serve fallback)
  game-3d.md    three + r3f + drei (Float/Stars/OrbitControls/Html only)
  game-2d.md    canvas + useRaf + emoji sprites + touch controls
  charts.md     recharts over sdk.data (polls/trackers/splitters) + the
                upload→papaparse→chart recipe (user CSVs at build OR runtime)
  motion.md     motion/react — springs, AnimatePresence, score pops
  art.md        generate_image: palette-consistent prompting, ≤4/app,
                gradients/emoji fallback when unavailable
  judge.md      AI-judged contests: upload/camera/canvas-draw → sdk.data
                gallery → ai.chat+images rubric grading → leaderboard + witty
                feedback (artifacts not people); secret-dealing recipe
  market.md     sdk.pot lifecycle (create/stake/ai-or-creator resolve/void) +
                unique-draw recipe + "settle up" fallback (losers tip winners)
examples/
  tip-jar.tsx   exemplar 1: payUSDC + counter("tips").top() leaderboard  ← e2e test fixture
  guestbook.tsx exemplar 2: data.collection("entries") insert/list + storage draft
```

**Deps available to generated code (curated, pinned, pre-installed in the
build workspace's resolution path — agent never touches package.json):**
`react`, `react-dom`, `@superjam/sdk` always; per loaded skill: `three` +
`@react-three/fiber` + `@react-three/drei` (3D as JSX — the LLM-idiomatic 3D
API), `recharts` (declarative dataviz), `motion` (the most LLM-known
animation API), `canvas-confetti`, `react-qr-code` (share links/wallets as
scannable codes), + the `./lib` helpers. Nothing else. The dep filter, in
order: LLM-idiomatic (stable API, heavy training-data presence) →
asset-free → declarative-over-imperative → amplifies an SDK primitive.
Bundle cost is pay-per-use (Bun tree-shakes per app: a tip-jar doesn't pay
for three). The "no extra deps" rule stays as the PRINCIPLE — **a skill
ships only with a recipe + worked exemplar + a passing real agent build**
(skill-CI: `skills/fixtures/*.json`, one spec per skill, regression-run
pre-kickoff). **NOT Next.js**: mini apps are origin-less static bundles
inside a sandboxed iframe — there is no server for Next to run; Next is the
host shell (§2/§4).
**Asset rule (load-bearing):** generated apps may load NO external **URLs** —
no textures, GLTF models, font files, remote image/audio (CSP + sandbox +
IPFS-safety). Sanctioned asset paths instead: (a) build-time agent art via
`generate_image` → `assets/` (§11); (b) build-time USER-ATTACHED files →
`assets/data/` (§2/§11 — "visualize my spreadsheet"); (c) runtime user
uploads/camera via `sdk.files.upload` (§9); (d) runtime user data files
(CSV/JSON) parsed client-side with papaparse. Everything else: 3D = geometry
+ colors/emissive; sprites = emoji; sound = synthesized `./lib/sfx`.
game-3d.md bans drei's network-loading helpers
(`Text`/`Environment`/`useTexture`/`useGLTF`) except against `./assets/`.
**Build-time vs runtime images:** generate_image = art direction (bg,
sprites, card art; paid once per build, instant at runtime, survives
IPFS/builder-death) · `sdk.ai.image` = per-user dynamic content (quota'd,
seconds-slow). Skill files teach the split.
⚑ PoC-validated (2026-06-12, this stack live): haiku built a complete r3f
3D game (timer, HUD, leaderboard, sfx, confetti) in **57s, first submit,
zero repairs** from the 3D skill file (bundle 1.42MB min ≈ 400KB gz);
**fable-5 composed TWO loaded skills (charts+motion) into a working poll
app in 52s, single submit** (bundle 0.9MB). Bundle budget: warn in submit
> 5MB. Styling = theme classes + inline styles.

---

## 11. Builder pipeline (`packages/builder`) — refine → spawn-an-agent

### Stage 0 — refine (idea → AppSpec, interactive, cheap+fast)

`builds.refine({ prompt, answers?, appId?, remixOfAppId? })` (protected; does NOT consume the
free build; quota REFINE_CALLS_PER_USER_DAY) → **two-model doctrine
(2026-06-12): refine and build are different jobs on different models.**
PRIMARY refine = **Gemini via AI SDK `generateObject`** (free tier, ≈2-4s),
running PLATFORM-side — no builder round-trip, and the wizard stays alive
when the builder is busy/down. Keyless fallback = the Agent SDK answer-tool
session on the builder box (PoC-proven; subscription `claude`, completion =
the zod-validated tool call, never parsed prose). The BUILD always goes to
Claude Code on the builder (below). Refine also **selects `skills`** — the
zod enum makes hallucinated skills impossible (§10 registry):

```ts
{ type: "questions", questions: { q: string, options: string[] }[],  // 2–4, chip-able
  similar?: Similar[] }
| { type: "spec", spec: AppSpec, similar?: Similar[] }

Similar = { slug: string, reason: string }   // ≤SIMILAR_MAX; server filters slugs
                                             // that don't match a real listed app

AppSpec = {
  name, slug, description, iconEmoji,
  category: "game"|"social"|"tool"|"creative"|"other",
  capabilities: ("payments"|"ai"|"social")[],
  features: string[],                       // concrete bullets
  data: { collections: { name, doc: Record<string,"string"|"number"|"boolean">,
                         writtenWhen: string }[],
          counters:    { name, keyedBy: string, meaning: string }[],
          storage:     { key: string, meaning: string }[] },
  payments?: { actions: { label, amountUsdc, to: "appTreasury" }[] },
  ai?: { uses: string[] },
  social?: { messagesSentWhen: string[] },  // when "social" declared
  ui: { layout: string, sections: string[] },
  skills?: ("game-3d"|"game-2d"|"charts"|"motion"|"art"|"judge"|"market")[],  // ≤3; refine
    // picks from the §10 registry; absent ⇒ keyword-heuristic fallback
  acceptance: string[],                     // self-check list for the build agent
}
```

Model returns `spec` directly when the prompt is already precise (no forced
friction; demo can skip the round with a sharp prompt). Pass prompt + prior
Q/A back in — stateless. (Tests stub refine with a canned tip-jar AppSpec
fixture, `category: "tool"` — code seam, not an env flag.)
**Similar-check:** the platform appends the listed-apps catalog to the refine
prompt — `status='listed'` capped at LIST_MAX, each as
`slug | name | description(≤140) | category` (≈3–4k tokens, fine for haiku) —
with "if the idea substantially duplicates a listed app, also return `similar`
(≤3) with a one-line reason". Skipped on adjust re-refines and remix refines
(wizard latency).
**Remix:** when `remixOfAppId` is set, the platform loads the base app's
`currentBuild.spec` and renders it into the refine prompt as "BASE SPEC — the
user is remixing this; extend/modify it per their changes and pick a NEW
name + slug".
**Why this stage exists:** a constrained template fill from a precise spec is
the regime where codegen rarely fails — and it's the meta-pitch: the platform
does spec-driven development, same loop this project was built with.

### Stage 1+ — build

`builds.create({ spec, appId?, remixOfAppId? })` (the two mutually exclusive;
a remix IS a build for quota purposes) enforces trial quota → inserts build(queued,
prompt = original idea, spec jsonb) → in-process FIFO, **max 2 concurrent
sessions** (no external queue) → `runBuild(buildId)`.

**Server-declared actions (the safe "server functions"): AI-oracle pot
resolution.** NOT arbitrary per-app server code (that's the microVM roadmap,
§11 security note) — the platform executes a FIXED, trusted action on the
app's behalf. A single `setInterval` sweep (same in-process pattern as the
build FIFO — no cron infra) scans pots past their `deadline` with
`resolver:"ai"`: it asks **Gemini with search grounding** for a forced answer
`{ option: <one of the pot's options> | null, confidence }`. Confident ⇒ set
`resolvedOption`, run the same pro-rata payout job as a creator resolve
(agent server wallet; per-stake `paidOutTxHash` makes it idempotent across
sweeps; failed transfers retry next tick) + inbox "you won X USDC 🎉". Unsure
/ refusal / no clear answer ⇒ leave the pot open and inbox the creator
"resolve manually". The creator can override an ai-pot any time via
`pot.resolve` (creator wins). Demo gold + thematically live: a World-Cup-match
pot that resolves ITSELF when the match ends.

### BUILDER_MODE=remote (default) — execute on the dev-box builder

`runBuild` does NOT run the agent inside the Railway container — the deployed
server ships no Claude CLI and holds no Anthropic key. It resolves the build's
`builder_agent` registry row (§7) and dispatches to its `endpointUrl` +
`token` — **the builder contract below is a PUBLIC PROTOCOL**: our
**`apps/builder`** (a ≈200-line token-gated Hono service on the dev box,
kristjan-dev VPS, where `claude` is subscription-authenticated) is just the
pre-seeded registry row #1; community agents (§14) are more rows. EXTERNAL
agents return **sources only** (`{files: {"src/app.tsx": …}}`) — the PLATFORM
seeds the template, runs Bun.build, zod-validates the manifest; a hostile
agent can only produce a hostile mini app, already contained by §6. 4-min
dispatch timeout. Contract (every route requires
`Authorization: Bearer <agent token>`):

- `POST /builds {spec, buildId}` → 202; 429 when 2 builds already run (the
  platform FIFO above just holds the job and retries)
- `GET /builds/:id` → `{status, events}` — platform polls at 1.5s and mirrors
  events into `build.events` jsonb (the same poll the web feed reads)
- `GET /builds/:id/artifact` → `{manifest, dist: [{path, contentBase64}],
  sources, costUsd, durationMs}` — fetched once on `done`. The platform
  zod-validates the manifest, uploads dist → S3, snapshots sources →
  `build.files`, then continues steps 4–6 below unchanged (S3 / app row / ENS
  are all platform-side). The builder keeps no durable state; workspaces are
  prunable.
- `GET /health` → includes `claudeAuth` from a real `claude auth status` parse
  (`Bun.which` lies — finding #4's ops note below)

Deploy story (**rehearsed end-to-end 2026-06-11 with the PoC**): the repo
checkout on the dev box IS the deployment — systemd user unit
`turbojam-builder` + `turbojam-caddy` docker container (host network, TLS via
Let's Encrypt). At M5: repoint the unit's WorkingDirectory/ExecStart at this
repo's `apps/builder`, swap the Caddyfile upstream to :4710, then
`systemctl --user restart turbojam-builder`.

### The agent session (runs inside apps/builder; `BUILDER_MODE=agent` runs it in-process for local dev)

1. **Seed workspace** `apps/server/.builds/<buildId>/` (INSIDE the repo so Bun
   resolves react from workspace node_modules; gitignored): template src +
   `SDK.md` + theme.css + examples/; iterate flow additionally seeds previous
   `build.files`; **remix flow seeds the PARENT app's `currentBuild.files` the
   same way**; user-attached files (§2) are written to `assets/data/` and the
   numbered prompt names them ("the user's data is at `<ws>/assets/data/x.csv`
   — parse with papaparse, bake its insights into the app"); refine already
   saw a file manifest (name, size, first ≈20 CSV rows) so the spec
   references the data concretely — but step 4 then creates a NEW app row (new slug w/ dedupe,
   owner = the remixer, version 1, `remixOfAppId` set; fresh
   `app_storage`/`app_record`/`app_counter` scope by construction — new appId).
2. **Spawn** `query({ prompt, options })` (`@anthropic-ai/claude-agent-sdk`):
   - **user prompt = the AppSpec rendered as markdown** + "implement so every
     `acceptance` item holds, then call submit" — the agent gets a precise
     spec, never the raw idea
   - `cwd` = workspace, `executable: "bun"`, **model fixed: `claude-fable-5`**
     (the most capable model — codegen quality is the product; PoC-proven
     2026-06-12: 52s for a two-skill charts+motion app, single submit; no env
     knob, no break-glass — keep it simple) — `maxTurns: 24`, hard timeout
     4 min (kill → failed)
   - `allowedTools: [Read, Write, Edit, Glob, Grep]` — **no Bash**; verification
     goes only through our tool
   - **`PreToolUse` path-gate hook** (NOT `canUseTool` — finding #1 below):
     every tool call carrying a file path is
     checked to resolve inside the workspace, else denied — Read/Glob/Grep
     accept absolute paths, and this server is a shared VPS; without the gate
     a hostile prompt could read other projects' files into the generated app
   - subprocess env stripped to `HOME`/`PATH`/`CLAUDE_CONFIG_DIR` (how the CLI
     finds the subscription credentials; invok's getSubprocessEnv hygiene) —
     agent sees the workspace and nothing else
   - in-process MCP server exposes TWO tools. **`generate_image({prompt,
     path: "assets/<name>.jpg"})`** — build-time asset generation via the
     same fal pipe as `sdk.ai.image`: writes the image INTO the workspace;
     `assets/` ships inside the bundle (dist) so generated art is local,
     relative-path, IPFS-safe — the "no external assets" rule's one
     exception. ≤4 images/build, cost → `build.costUsd`; no FAL_KEY ⇒ tool
     answers "unavailable — use gradients/emoji" (graceful). skills/art.md
     teaches palette-consistent prompting. And **`submit({ manifest })`**
     (invok's validate-before-write `write_artifact` pattern): zod-validates
     manifest (name/slug/description/iconEmoji/category/capabilities),
     verifies every `./assets/` reference in source exists (broken-ref
     builds fail in-loop), runs
     `Bun.build({ entrypoints: [main.tsx], outdir, target: "browser",
     minify: true, naming: "[name].[ext]" })` on the workspace, and returns
     compile errors AS THE TOOL RESULT — the agent fixes and re-submits.
     **Completion = a successful submit call, never parsed prose.** Session
     ends without one ⇒ status `failed` with last error.
   - system prompt: "Edit `src/app.tsx` (you may add `src/components/*.tsx`).
     Deps: react + @superjam/sdk + exactly what your loaded skills/*.md
     document — never anything else, never external assets (except your own
     ./assets/). Style with theme.css classes + inline styles. When done,
     call `submit`. Fix errors until it passes."
   - **Skill loading**: all `skills/*.md` are seeded (copying is free); the
     numbered prompt steps include "Read `<ws>/skills/<skill>.md`" for exactly
     `spec.skills` (refine-selected, zod-enum'd; keyword-heuristic fallback
     when absent) — unselected skills cost zero tokens. `skills/INDEX.md`
     (one-liners) is the agent's self-serve escape hatch mid-build.
     PoC-proven: fable composed charts+motion correctly from two loaded
     skill files, first try.
3. **Live progress feed**: the message loop appends compact events to
   `build.events` jsonb (`{t, kind: "tool"|"text"|"error", label}`, cap 100,
   e.g. "✏️ src/app.tsx", "🔨 submit: 1 type error", "✅ bundle ok") — `/build`
   polls `builds.get` (1.5s) and renders the activity feed. **Watching the
   agent work IS the demo** (v0/bolt precedent); start a build early in the
   pitch and narrate over it.
4. **After submit**: snapshot workspace sources → `build.files` jsonb (feeds
   iterate + a "view source" tab on /manage — transparency for judges); cost +
   turns from the SDK result message → `build.costUsd`; dist → S3
   `apps/<appId>/<buildId>/`; app row create/update (slug dedupe `-2`,`-3`),
   bundleKey + currentBuildId, status `deployed`.
5. **registering** — `onchain.mintApp()` — agent account
   (§5.1). NESTED naming (decision 2026-06-13): the app mints UNDER the
   owner's user node — `onchain.ensureUserNode(username)` first (creates
   `username.superjam.eth` if missing: createSubnode(ENS_PARENT_NODE,
   username) + setAddr(60, userWallet) + setText("unlink.address",
   user.unlinkAddress) — ENS as the discovery layer for private payments;
   the receiving address is safe to publish, transfers to it stay unlinkable
   (§15). Normally already minted at World-verify time, §14), then
   `L2Registry.createSubnode(node("username.superjam.eth"), appslug, agentAddr, multicall[
   setAddr(60, treasury), setText("url", "https://superjam.fun/app/"+slug),
   setText("avatar", appsOrigin+"/a/"+slug+"/icon.svg"),
   setText("description", …), setText("app.capabilities", csv),
   setText("app.builder", "builder.superjam.eth"), setText("app.version", v),
   setText("app.category", category),
   remix ⇒ setText("app.remixOf", "<parentSlug>.superjam.eth"),  // lineage on chain
   (stretch) setContenthash(ipfs CID) ])` — apps resolve as
   `appslug.username.superjam.eth` (web URL stays superjam.fun). **ENS failure
   must NOT fail the build** (done + ensName null + retry button on /manage).
   FALLBACK (pre-rehearsed, §23): if nested subnodes fight Durin, go flat —
   `appslug.superjam.eth` + `setText("app.owner", "username.superjam.eth")`
   (ownership still on chain). PARENT UPGRADE (optional, §16): swapping
   `ENS_PARENT_NODE` to the DNSSEC-imported `namehash("superjam.fun")` makes
   names read `….superjam.fun` — same mechanics, one constant. Decide at the
   §23 rehearsal, not at the venue.
   RESERVED LABELS: usernames + flat appslugs share one namespace with real
   DNS subdomains of superjam.fun — reject `www dev apps apps-dev builder
   gateway mail` (one constant list, checked at username claim AND slug
   dedupe).
6. **done** — UI auto-opens. Target: **< 2.5 min prompt → playable**, most
   of it watchable.

### ⚑ PoC smoke-test findings (2026-06-10, `~/code/turbojam-poc` — VERIFIED on this box)

The builder half was built and run end-to-end (re-validated 2026-06-11 through
the remote builder). Six findings that CHANGE the spec — bake these into the
real build:
1. **`canUseTool` does NOT fire for tools listed in `allowedTools`** (they're
   pre-approved). The §11 path gate via canUseTool would silently no-op — an
   adversarial prompt read `/etc/hostname`. **Fix: enforce path confinement
   with a `PreToolUse` hook** (hooks always fire); block when
   `tool_input.file_path|path` resolves outside the workspace.
2. **`allowedTools` does NOT restrict tools** — it only auto-approves. Bash
   stayed available and the agent wandered with it. **Fix: `disallowedTools:
   ["Bash","Task","TodoWrite","Skill","ToolSearch"]`** — **WebFetch/WebSearch
   re-ALLOWED (2026-06-13, demo posture)**: builds may fetch public URLs the
   user's prompt references (repos, docs) — "give it a repo, get an explainer".
   System prompt line: "WebFetch only URLs from the spec — never secrets,
   never internal hosts." Widened egress on a shared VPS is accepted for the
   weekend; microVMs remain the production answer (security note below)
   (Skill/ToolSearch are newer CLI tools the agent detoured into on 2026-06-11)
   + a system-prompt line "you have no terminal; only edit src/app.tsx and
   call submit."
3. **Build-workspace module resolution**: a `.builds/<id>/` dir nested under
   apps/server does NOT resolve workspace-hoisted react/react-dom →
   `Bun.build` fails "Could not resolve react-dom/client". **Fix: the SERVER
   package owns `react`+`react-dom` as direct deps; `symlink` server
   `node_modules` into each build workspace at seed time.**
4. **Timings (haiku builder):** template cold `Bun.build` ≈140ms; full agent
   build (spawn → write → submit → bundle) ≈28s, single submit, no repair
   round-trip needed. Comfortably inside the <2.5min demo budget.
   (Dev-box ops note: `claude` is CLI-authed (no API key) → gate agent mode on
   `Bun.which("claude")` + a real auth parse. Don't background a server with a
   `pkill -f` pattern that matches your own launch command — it self-kills.)
5. **The path hook must resolve relative paths against the WORKSPACE** — the
   agent sends cwd-relative paths (`src/app.tsx`); a bare `resolve(p)` in the
   PreToolUse hook resolves against the server process cwd and blocks
   legitimate edits. The agent then flails for ≈30s and may `submit` the bare
   template — which compiles, so the build "succeeds" while shipping nothing.
   **Fix: `resolve(workspace, p)`** (absolute paths pass through unchanged).
6. **Read-before-write**: the CLI denies Write/Edit on an existing file the
   agent hasn't Read this session. **Fix: system-prompt line "FIRST Read
   src/app.tsx, THEN Edit it."** With #5+#6 in place the loop is clean
   Read→Edit→submit, ≈30s/build (re-timed 2026-06-11 through the remote
   builder, Railway→VPS round-trips included).
7. **The Read tool requires ABSOLUTE paths and the agent cannot discover its
   workspace root** — it burned ≈50s guessing paths (2026-06-12). **Fix: put
   the absolute workspace path AND the exact file paths in the user prompt**
   (`Your workspace root is /…/.builds/<id>; 1. Read <ws>/SDK.md; 2. Read
   <ws>/src/app.tsx; 3. Edit it; 4. submit`). With #5–#7: 40s/build including
   reading SDK.md, zero detours.

### ⚑ Deploy proven (Railway, 2026-06-11) — gotchas for §18

The PoC (`~/code/turbojam-poc`) deployed live: web + server on Railway, agent
build runs end-to-end (fails only on missing auth, gracefully). §18 additions:
- **Next.js standalone binds to the container hostname, not 0.0.0.0** → edge
  502. Set `HOSTNAME=0.0.0.0` on the web service. (Pin `PORT` to the domain's
  target port too.)
- Monorepo per-service Dockerfile via `RAILWAY_DOCKERFILE_PATH` service var
  (the deploy-tarball path ignores per-app railway.toml unless config-as-code
  path is set).
- The Railway server image ships NO Claude CLI — agent builds run on the dev
  box (the remote-builder split). Load-bearing: `Bun.which("claude")` is true
  even when unauthenticated, so the builder's `/health` must parse
  `claude auth status` for the truthful signal.
- Remote split rehearsed live (PoC, 2026-06-11): Railway server with
  `BUILDER_URL` + `BUILDER_TOKEN` proxied a real agent build to the VPS builder
  (systemd user unit `turbojam-builder` + dockerized Caddy, Let's Encrypt on
  `37.60.232.68.sslip.io`) and served the resulting mini app publicly.
- FULL pipeline rehearsed (PoC, 2026-06-12): Railway bucket (`create_bucket`
  via MCP; creds exposed as `${{bucket.BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/
  ENDPOINT/REGION}}` reference vars), artifact pull-back (`GET
  /api/build/:id/artifact`, base64 file list), platform poll loop that clamps
  `done` until the upload lands (no iframe race), bundles served from the
  bucket — verified working with the builder unit STOPPED. Bun's native
  `S3Client` works against the Railway/Tigris endpoint with default options
  (write/read/list all fine; `list()` returns `{contents: [{key}]}`).
- Caddy gateway rehearsed (PoC, 2026-06-12): single public origin, path-routes
  `/api/* /a/* /health` → server, else → web; `SERVER_URL`/`WEB_URL` env
  upstreams over `*.railway.internal`. **`@hono/node-server` accepts
  `hostname: "::"`** and dual-stack works on Railway's IPv6 private network
  (no need to switch to Bun.serve). Web cutover = blank `NEXT_PUBLIC_API_BASE`
  build arg → same-origin. Transient cold-start quirk: first hits through the
  gateway can 404 from Next's prerender cache for a few seconds.

### BUILDER_MODE=oneshot (escape hatch)

Single `generateText` (fable, ≈8k tokens, temp 0.3) filling `app.tsx`; output
contract `<manifest>{json}</manifest><code>app.tsx</code>` parsed by regex +
zod; ONE repair round-trip with compiler stderr; same steps 4–6. ≈20s, dumber.
Keep green as the fallback if the Agent SDK fights the Docker env mid-hackathon.

### Test fixture (code seam, not an env mode)

The e2e build test stubs the builder with the tip-jar example + synthetic
events — no LLM call, no env flag.

Security note — honest hackathon posture: a hostile prompt can at most make
the agent write a hostile mini app — which then runs in the opaque-origin
sandbox with capability gating (§6). The build agent itself: no Bash, no
network tools, stripped env, cwd + `PreToolUse` path-gate hook confining all
file access to the workspace, 2-concurrent cap, 4-min kill. The builder is
additionally a separate token-gated origin holding no platform creds (§6). This is good-enough
isolation for a weekend on a shared VPS; **production answer (pitch line, not
weekend work): builds move into microVMs** (Vercel Sandbox / Firecracker /
invok-style per-session containers).

Icon: server route `GET /a/:slug/icon.svg` renders iconEmoji into an SVG.
App treasury v1 = owner's wallet address.

---

## 12. oRPC API surface (`packages/api`)

House shape: `publicProcedure`/`protectedProcedure` middleware, zod inputs,
`commonErrors` (BadRequest/Unauthorized/Forbidden/NotFound/Conflict/Internal +
QuotaExceeded/PaymentRequired), typed `AppRouterClient` exported for web.

```ts
appRouter = {
  profile:  { me(),
              topup() },  // protected + worldVerified; 1/day (TOPUP_PER_HUMAN_PER_DAY,
                          // else QuotaExceeded); agent server wallet sends TOPUP_USDC
                          // Base Sepolia USDC AND seeds the Arc private balance
                          // (Unlink faucet.requestPrivateTokens) — both rails, §15.1

  apps:     { list({status?}), listFromEns(), get({slug}), mine(), delist({appId}),
              explore({q?, sort? /*new|trending|top*/, category?}),
                // listed only, cap LIST_MAX; rows + playCount (_plays counter)
                // + remixCount (GROUP BY remixOfAppId)
              recipe({slug}) },  // PUBLIC, listed apps only: { name, iconEmoji,
                                 //   category, owner:{username}, prompt, spec,
                                 //   remixOf?, remixCount } — prompt+spec from currentBuild
  agents:   { register({name, endpointUrl, priceUsdc, walletAddress}),
                // protected + worldVerified (human-backed); mints agent ENS (§16)
              list(), mine(), disable({agentId}) },
  builds:   { refine({prompt, answers?, appId?, remixOfAppId?}),  // → {questions[]} | {spec} (§11 stage 0)
              create({spec, appId?, remixOfAppId?, agentId?, paidTxHash?}),
                // quota: !worldVerified && freeBuildsUsed>=1 → Forbidden;
                // paid agent ⇒ verify USDC Transfer to agent wallet ≥ price
                // (same receipt-check shape as publish.submit)
              get({buildId}), listMine() },
  world:    { rpContext(), verify({idkitResult}) },
  publish:  { submit({appId, txHash}) },
  reviews:  { list({appId, cursor?}),   // PUBLIC: rows {username, worldVerified:true,
                                        //   rating, text, createdAt}, newest-first
              upsert({appId, rating, text?}),  // requires worldVerified → else
                                        //   Forbidden REVIEW_REQUIRES_VERIFICATION;
                                        //   rating 1-5 int; own-app reviews rejected
              remove({appId}) },        // own review only
  inbox:    { list(),        // { unread, messages: [{id, from:{username}, appName,
                             //   appSlug, text, data, link, createdAt, read}] }
              markRead() },  // all-read (PoC shape)
  bridge:   {                               // called ONLY by host shell on behalf of an app
    storage: { get, getMany, set, delete, list, clear },
    data:    { insert, get, update, delete, list },     // update/delete check row.userId
    counter: { increment, top },
    files:   { upload },      // magic-byte sniff, ≤2MB, store → /f/<appId>/<id>
    pot:     { create, stake, get, resolve },  // stake verifies the USDC
                              // Transfer receipt to the escrow (publish.submit
                              // shape); resolve = async payout job from the
                              // agent server wallet (pro-rata, per-stake
                              // paidOutTxHash gate = idempotent across retries),
                              // events appended. AI-RESOLVE (§11): a platform
                              // sweep job sets resolvedOption from live data
    messages:{ send, list },  // send: fromUserId = session user; resolve `to`
                              // username (unknown → BadRequest); reject self-send;
                              // text ≤280, data ≤1KiB; link validated against
                              // /app/<slug>[?d=…] on the web origin, stored as a
                              // normalized relative path; caps 5/min/(from,to) +
                              // 20/min/from (in-memory buckets — single process)
    ai:      { chat },                      // proxies @ai-sdk/anthropic, AI_APP_MODEL,
                                            // maxOutputTokens capped, daily quota
    payments:{ payX402 },                   // (GATED, §9) capability "payments";
                                            // host-side: reject url whose host ∉
                                            // X402_ALLOWED_HOSTS, amount > X402_MAX_USDC,
                                            // or over _x402_quota; confirm sheet → then
                                            // Unlink withdraw → Circle Gateway pay(url)
  },
  health:   publicProcedure.handler(() => "OK"),
}
```

`apps.get` response includes `category, remixOf:{slug,name}|null, playCount,
remixCount, ratingAvg, ratingCount` (viewer header + lineage chip + reviews
aggregate); `apps.explore` rows carry `ratingAvg/ratingCount` too (computed
GROUP BY — no denormalized columns).
Bridge procedures: input includes `appId`; identity from session; validate
app exists + (status != delisted). `publish.submit`: viem `getTransactionReceipt`
→ assert USDC `Transfer` log to=TREASURY, value ≥ fee, **Transfer log `from`
== owner wallet** (NOT the outer `tx.from` — EIP-3009 payments are submitted
by the platform RELAYER while the ERC-20 log keeps the signer's address, §15.1;
same rule for the paid-agent-build check and `pot.stake`),
txHash unused → app.status=listed (requires worldVerified).
Web client: `RPCLink` with auth header injection; TanStack Query via
`@orpc/tanstack-query`.

---

## 13. Auth (Dynamic-only — no Better Auth this build)

- Web: `DynamicContextProvider` (env id; `overrides.evmNetworks` Base + Base
  Sepolia (+ Arc stretch)); prebuilt auth widget (headless email OTP only if
  time). Email signup auto-creates the embedded TSS-MPC wallet (default
  embedded wallets — no special AA/7702 toggle needed; gasless is EIP-3009
  relay, §15.1).
- Every oRPC call: `Authorization: Bearer <dynamic JWT>` (`getAuthToken()`).
- Server context middleware: verify via Dynamic JWKS (jose, cached), upsert user
  on `dynamicUserId`, capture walletAddress. No auth bypass — local dev logs
  in with real Dynamic (allowlist localhost in the dashboard); API tests mint
  their own JWTs against a test JWKS (jose) at the verify seam.
- Signing: ONE `useSignAndSend()` hook used by the confirm sheet — the single
  money seam (§15.1). For a USDC payment it builds an **EIP-3009
  authorization** (`transferWithAuthorization`: from=user, to, value, random
  bytes32 nonce, validAfter/validBefore window), signs it with the Dynamic
  embedded wallet (`signTypedData` — gasless, no popup beyond our sheet), and
  POSTs it to `payments.relay` (§12); the platform server wallet submits the
  tx, pays the ETH, waits the receipt, returns the real hash. Generic
  non-USDC `wallet.sendTransaction` → plain
  `createWalletClientForWalletAccount` (Dynamic viem interop), gas covered by
  the verify/top-up ETH backstop (§15.1). Either path returns a REAL tx hash,
  so receipt verification (§12) is branch-agnostic.

---

## 14. World: ID gate + AgentKit (core)

- Always live (the World app exists pre-kickoff): IDKit v4 widget needs server-signed `rp_context` → `world.rpContext()`;
  preset `deviceLegacy` (judges verify in minutes; accept Orb too); backend
  `world.verify()` forwards result **as-is** to
  `POST developer.world.org/api/v4/verify/{rp_id}` (backend validation = hard
  track requirement); store nullifier (one human = one publisher AND
  one review per app per human — reviews are the sharpest sybil story:
  `reviews.upsert` hard-requires worldVerified), set worldVerified. Dev: `environment: "staging"` + simulator.worldcoin.org.
- **AgentKit = the open builder marketplace (core, M8):** anyone
  World-verified can register THEIR build agent (`/agents`, §2/§12) — every
  marketplace agent is bound to a verified human (the AgentKit primitive),
  speaks the public §11 builder protocol, gets an ENS name under its owner
  (§16), and earns its build price in USDC directly. Our own agent is
  additionally registered via the AgentKit CLI pre-event (bound to Kristjan's
  World App) + the agent identity panel on `/build`. Demo seeding: register
  OUR VPS builder twice — second row "Maria's Art Builder 🎨, 1 USDC", same
  endpoint, prompt biased to always load the art skill — a real marketplace
  without a second AI. Cherries in order (timeboxed, cut first): **x402**
  (`@x402/hono` on the dispatch path — the platform's Dynamic server wallet
  pays the builder endpoint per request; World pairs AgentKit with x402) →
  per-agent **ERC-8004 + reputation** (§16). **Fallback:** World ID track
  stands alone; the marketplace minus payments is still the AgentKit story.
  (NOTE — two distinct x402 things: THIS cherry is platform→builder per
  dispatch, NOT private; the nanopayments-prize leg is `sdk.payments.payX402`
  — user→paid resource, PRIVATE via Unlink+Circle Gateway, §3/§9/§15.)

---

## 15. Payments (USDC) — two rails, one rule

**The rule:** the only payments that CAN'T be private are the ones the platform
must cryptographically verify by reading an on-chain receipt — publish fee, pot
stakes, paid agent builds (§12). Those go to platform-controlled addresses and
their provability IS the feature, so they're **public** (Base Sepolia,
sponsored). Everything peer-to-peer — **tips + app `payUSDC` pay-actions** — has
no such constraint (social proof = the server-stamped leaderboard counter the
user opts into by tapping), so it is **private by default** (Unlink on Arc
testnet). No public/private toggle; not a user-facing choice.

- `packages/onchain`: chain defs baseSepolia (core) / arcTestnet (privacy,
  5042002 — ships in `viem/chains`, RPC `https://rpc.testnet.arc.network`;
  **gas = USDC natively, so no paymaster exists or is needed on Arc, ever**;
  18-dec native ⟷ 6-dec ERC-20 at `0x3600…0000` are the SAME balance — never
  mix units, never sum the two reads); USDC addresses per chain;
  `parseUsdc/formatUsdc` (6 dec).
- **Private rail (default for tips/pay-actions):** `payUSDC` → Unlink shielded
  transfer on Arc testnet, relayed (sender pays no gas, §15.1); recipient
  resolved `@username` → `user.unlinkAddress`; the confirm sheet reads "Send
  0.50 USDC privately 🕶". ONE adapter in the host payments handler — if the
  Unlink client errors / `UNLINK_API_KEY` absent, it **silently falls back to a
  public Base Sepolia ERC-20 transfer** (same call shape, "(privacy
  unavailable — sent publicly)" toast). The demo never dies. The same Unlink
  adapter has a SECOND operation (gated, §3/§9): **`payX402`** — instead of a
  private→private `transfer`, it `withdraw`s to a platform plain payer EOA →
  Circle Gateway `deposit`+`pay(url)`, paying an x402 resource privately. Two
  Unlink-guide constraints hold verbatim: *"the Gateway payer must be a plain
  EOA — never an Unlink execution/smart account"*, and *"avoid a same-size
  deposit and withdrawal in the same flow"* (park a larger pool balance,
  withdraw smaller amounts).
- **Public rail (publish / pot stakes / paid builds):** ERC-20 transfer on Base
  Sepolia; host builds calldata; sheet shows amount + recipient (ENS name if
  known); cap §2; gasless via EIP-3009 relay (`useSignAndSend`, §13/§15.1). Pay-to-publish:
  1 USDC → treasury → `publish.submit` (§12).
- **Arc/Unlink rehearsal = Thu go/no-go (§23)**, isolated in `packages/onchain`
  + the Unlink adapter. Fail ⇒ tips stay public, nanopayments submission drops.
- Demo funding: the **Top-up button** (§15.1 rung 3) seeds both rails; demo
  wallets may also be pre-funded beforehand (no onramp needed — why Blink was
  dropped).

### 15.1 Gas story + onboarding ladder (verified 2026-06-13)

The pitch promise — "no seed phrase, no gas, no network picker" — made real.
Users NEVER hold or think about ETH; the agent runs on pre-funded ETH.

**Gas matrix (who pays gas, where):**

| Action | Chain | Gas payer | Mechanism |
|---|---|---|---|
| ENS user-node + app mints, agent ENS | Sepolia (L1) + Base Sepolia (Durin L2) | agent server wallet | pre-funded ETH (Dynamic server wallets have NO sponsorship — checked docs) |
| ERC-8004 register + reputation writes | Base Sepolia / Sepolia | agent server wallet | pre-funded ETH |
| **Tips + app pay-actions (default)** | Arc testnet | Unlink relayer | private transfers relayed — sender pays no gas (§15) |
| Publish fee, paid builds, pot stakes | Base Sepolia | **gasless** | EIP-3009 `transferWithAuthorization` — user signs, platform server wallet relays + pays ETH (§13) |
| Pot payouts / refunds | Base Sepolia | agent server wallet | pre-funded ETH (escrow custodian, §9) |
| Public-tip fallback (Unlink down) | Base Sepolia | **gasless** | same EIP-3009 relay path as the public rail |
| `payX402` private nanopayment (gated) | Arc testnet | Unlink relayer + Circle Gateway | withdraw relayed; Gateway pays in USDC (Arc gas = USDC) |
| Anything else on Arc | Arc testnet | user, in USDC | gas IS USDC natively — no paymaster |

Gasless mechanism (verified 2026-06-13, live docs): **USDC-native EIP-3009
`transferWithAuthorization`** — Circle USDC implements it on Base + Base
Sepolia (Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`). The
user signs an off-chain EIP-712 authorization (gasless; Dynamic embedded
wallets `signTypedData` natively); our EXISTING platform/agent server wallet
submits `transferWithAuthorization(from,to,value,validAfter,validBefore,nonce,sig)`
and pays the ETH. NO paymaster, NO bundler, NO smart-account, NO ZeroDev —
just our relay route + the server wallet we already fund. The user keeps their
plain EOA and never holds ETH; the outer `tx.from` is the relayer while the
ERC-20 Transfer log keeps the signer's address, hence the §12 rule. nonce =
random bytes32 (one-time), validBefore bounds the window — server rejects
replays + expiry. (Considered + dropped: ZeroDev/7702 — dashboard + gas-policy
+ bundler infra for no gain here; Circle Paymaster — adds a bundler; Dynamic
native `sendSponsoredTransaction` — enterprise-gated, a free swap-in behind
the same seam if granted at the booth.)

**Onboarding ladder (the judge path, zero crypto knowledge):**

1. **Browse** — explore + play listed apps; no login.
2. **Email login** — Dynamic OTP → embedded wallet, username from
   email prefix. Unlocks the 1 free build. No funds needed for anything yet.
3. **World-verify** (device) → agent mints `username.superjam.eth`
   (agent-paid) → unlocks builds #2+/publish/reviews AND provisions the
   user's `unlink1…` private-payment account (§15). World ID is exactly what
   makes the next step's faucet sybil-safe.
4. **Top up** — an explicit "Top up" button on `/me` (and in the confirm
   sheet's insufficient-balance state). Tap → the platform server wallet
   sends `TOPUP_USDC="5"` Base Sepolia USDC AND seeds the Arc private balance
   (Unlink `faucet.requestPrivateTokens`) — both rails in one tap, World-gated,
   1/day. Copy: "Demo top-up — in production this is a card on-ramp or an
   external wallet transfer."
5. **Spend** — tips are private by default ("Send X USDC privately 🕶");
   publish / paid build / pot stake are public. Either way the confirm sheet
   shows only "Send X USDC" — no gas line, and the wallet never holds ETH at
   any rung.

**Testnet-exclusive posture (decision 2026-06-13):** the whole app runs on
testnet — Base Sepolia (core: wallets, USDC, payments, publish, pots) +
Sepolia (ENS L1, `superjam.eth`) + Arc testnet (the Unlink privacy lane).
This is forced: Arc mainnet ships only summer 2026 and Unlink has no mainnet
deployment, so the privacy rail is testnet-only by necessity — and a split
"mainnet core + testnet privacy" was incoherent, so everything is testnet.
Demo realism comes from the FLOWS, not the chain id. Mainnet is the
post-event roadmap: a config flip (`chainForEnv` → base, swap RPCs/registry
addresses, fund the relay wallet on Base) plus CCTP to bridge the public and
private rails once Arc mainnet exists.

**Fallback (pre-rehearsed Thu, §23):** if the EIP-3009 relay fights the
Dynamic signer, the Top-up button additionally sends 0.0005 Base Sepolia ETH
alongside the USDC (same server-wallet adapter, ≈20 lines) and `useSignAndSend`
takes its plain-tx branch — zero code-shape change either way.

---

## 16. ENS reader (chain-sourced catalog)

`apps.listFromEns()`: viem `getLogs(SubnodeCreated)` on `ENS_L2_REGISTRY`
(fromBlock = registry deploy, cached in-memory 60s) → labels → resolve
`url/avatar/description/app.*` text records (CCIP-read via L1 or direct L2
registry reads — direct L2 is fine and faster) → catalog rows from chain
alone — including `app.category` and `app.remixOf`, so the chain-sourced feed
keeps categories AND the remix provenance tree. Naming is TWO-LEVEL
(§11): user nodes under the parent, jam nodes under users — walk both levels
of SubnodeCreated; a profile's jams are enumerable from its user node alone.
**No UI source toggle** (the old "source: DB / ENS ⛓" control was removed in the
Toybox design — §2): chain facts surface **inline** instead — every name tag and
remix chip on the feed/jam page links ↗ to Basescan, and `listFromEns()` can
back the feed directly. Pitch (narrated, not a button): ENSNode = the production
indexing path; delete our DB and the catalog survives.

### Parent name: `superjam.eth` on Sepolia (ship path); DNSSEC-`superjam.fun` = optional upgrade

The testnet-only posture (§15.1) fixes the ENS parent as **`superjam.eth`
registered on Sepolia ENS** — resolver → Durin L1Resolver on Sepolia →
L2Registry on Base Sepolia, the exact flow §23 already rehearses. Names read
`appslug.username.superjam.eth`; the web domain stays `superjam.fun` (the
`url` text record points at `https://superjam.fun/app/<slug>`). This is the
lower-risk path — no DNSSEC/DS propagation on the critical path.
- **Optional upgrade — DNSSEC-import `superjam.fun` into ENS:** ENS supports
  any DNSSEC-signed DNS name as a first-class node, so the product's own web
  domain can BE the ENS parent (`tipjar.kris.superjam.fun` is then both the URL
  AND the resolvable name — URL = payment identity = agent identity, one
  namespace; deeper ENS usage than minted `.eth` subnames). Everything
  downstream (Durin resolver, agent mints, ENSIP-25/26) is byte-identical to a
  `.eth` parent — it's purely a `ENS_PARENT_NODE` swap. **If attempted
  in-event it is Sepolia DNSRegistrar ONLY** (ENS has a Sepolia DNSSEC
  registrar) to stay all-testnet; mainnet DNSSEC import is the post-event
  roadmap. Setup: DNS on Cloudflare → enable DNSSEC → DS record at the
  registrar → on-chain claim via the ENS DNS-import flow → `setResolver` to the
  Durin L1Resolver + `setL2Registry`. Gated on the Thu rehearsal (§23); if
  DS propagation drags or it fights Durin, ship on `superjam.eth` and mention
  the import as the "one namespace" roadmap line.
- **Dual-plane reuse is intentional either way:** `builder.superjam.fun` is BOTH
  a DNS A record (the VPS builder endpoint, TLS via Caddy) and the agent's ENS
  identity name. DNS and ENS resolve on separate planes; they don't conflict.
- **Forward resolution only:** name → address works everywhere gas-free. Primary
  names (reverse: address → name) need an on-chain reverse-record tx per user —
  out of scope; say so honestly if a judge asks rather than demoing it broken.

### Builder-agent identity records (ENSIP-25 + ENSIP-26 — prize page links both)

On `builder.superjam.eth` (pre-minted under the Sepolia parent; records set by
the agent's own wallet, M7, ≈1h each):
- **ENSIP-26 agent text records**: `agent-context` = markdown describing the
  agent (what it builds, how many apps shipped, how to use it) and
  `agent-endpoint[web]` = `https://superjam.fun/build`. Standard ENSIP-5
  setText — trivial.
- **ENSIP-25 registry verification**: register the builder agent in the
  **ERC-8004 registry** on testnet (`ERC8004_REGISTRY`, §1 — same CREATE2
  address as mainnet `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` if deployed,
  else our own reference deploy; one tx from the agent wallet → get `agentId`),
  then set text record
  `agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][<agentId>]`
  = `"1"` (key embeds the registry's ERC-7930 address; value just needs to be
  non-empty). Verification = a single resolver lookup — show it in the agent
  identity panel on `/build`.

Apps keep our custom `app.*` keys (they're apps, not agents); the AGENT gets
the standardized records. **Marketplace agents (§14) get the same treatment**:
at registration, mint `<agent-slug>.<username>.superjam.eth` under the owner's
user node (the nested mint, §11) — cherry #1: also register them in the
ERC-8004 **Identity registry** + ENSIP-25 record. **Cherry #2 — onchain agent
reputation:** every one-per-verified-human app review on an agent-built app
ALSO writes a feedback entry (rating + review-text hash, relayed by the
platform agent wallet) to the builder agent's ERC-8004 **Reputation registry**
profile — verified-human reviews become un-astroturfable onchain agent track
records (the World×ENS×8004 weave). (Apps-as-agents — each mini app
ERC-8004-registered, agent-to-agent calls between mini apps — is the
deliberate POST-hackathon roadmap line: mention in Q&A, don't build.) Combined with World AgentKit registration, the
builder has: human backing (AgentKit) + onchain identity (ERC-8004) + verified
name + discovery records (ENS).

---

## 17. Serving + gateway

- `GET /a/:slug/*` on server: app lookup (slug→currentBuildId) → stream S3
  `apps/<appId>/<buildId>/<path>`; in-memory LRU (50 entries); `index.html`
  no-cache, assets `immutable, max-age=31536000`; correct MIME; path-traversal
  guard. `GET /a/:slug/icon.svg` per §11.
- Caddyfile: `/rpc/* /api/*` → server:4701; host `apps[-dev].superjam.fun` →
  server (path-prefixed `/a`); else → web:4700. Web responses get CSP
  `frame-src <appsOrigin> <dynamic origins per their docs>`; apps origin
  responses get `X-Frame-Options` REMOVED + CSP `frame-ancestors <web origin>`.
- Serving is platform-only **by design**: bundles live in S3, never on the
  builder — the dev-box VPS is demo-critical only while a build runs; every
  already-published app keeps working if it dies.
- Apps-origin responses also carry CSP `script-src 'self'; object-src 'none';
  base-uri 'none'` (bundles are external files only) — see §8 hardening note.

---

## 18. Deploy (Railway, dev-flow)

- Branches: `dev` (default, auto-deploy → dev env) + `main` (prod). Merge-commit
  PR to promote, never squash. Push dev at coherent testable states.
- Railway project `superjam`: gateway (Caddy image, sonara shape), server
  (plain **oven/bun** image — **no Claude CLI, no Anthropic key**; agent builds
  run on the dev-box builder, §11; `bun run src/server.ts`, healthcheck
  `/health`, watch paths incl. `packages/db/**` — migration redeploys), web
  (Next standalone; `NEXT_PUBLIC_*` as **Build Args**, not Variables), Postgres,
  bucket. Custom domains incl. apps subdomains per env. Migrations run on
  server boot.
- **Builder (NOT on Railway)**: kristjan-dev VPS. systemd user unit
  `turbojam-builder` (EnvironmentFile `~/.config/turbojam/builder.env`, where
  `BUILDER_TOKEN` lives) + `turbojam-caddy` docker container (host network,
  TLS via Let's Encrypt). Hostname `builder.superjam.fun` → A record
  `37.60.232.68` (until the domain exists: `37.60.232.68.sslip.io`).
  Deploy = `git pull` + `systemctl --user restart turbojam-builder`.

---

## 19. Tests + verification matrix

bun test, pglite for DB-backed (sonara test-utils shape). Required tests:
- shared: typeid round-trip; bridge envelope schemas (good/bad messages).
- db/api (pglite): storage quotas (1001st key fails); data ownership
  (update/delete other user's row → Forbidden); counter increment concurrency
  (two parallel increments == +2); slug dedupe; trial quota (2nd build
  unverified → Forbidden); reviews: unverified upsert → Forbidden, second
  upsert replaces (UNIQUE), rating bounds reject 0/6, own-app review rejected;
  publish.submit log verification (mock viem client:
  wrong recipient / amount / reused hash all rejected; a relayed EIP-3009 tx
  whose outer `from` is the platform relayer but whose Transfer log `from` ==
  signer is ACCEPTED; replayed nonce + expired validBefore rejected — §15.1).
- payments (pglite, stubbed adapters): `payUSDC` routes to the Unlink (private)
  adapter by default; when that adapter throws, it falls back to the public
  Base Sepolia transfer (same return shape) — both paths asserted at the seam.
- profile.topup: unverified → Forbidden; 2nd call same day → QuotaExceeded;
  `unlinkAddress` stored once and idempotent on re-register.
- payX402 (stubbed Unlink+Gateway adapters): a `url` whose host ∉
  `X402_ALLOWED_HOSTS` is rejected BEFORE any payment; `maxAmount` >
  `X402_MAX_USDC` rejected; 11th call/day → QuotaExceeded; missing `payments`
  capability → FORBIDDEN_CAPABILITY (the Gateway call itself is stubbed).
- messages (pglite): self-send rejected; 6th msg/min/pair → RATE_LIMITED;
  unknown `to` username → BadRequest; link validation (external URL / wrong
  path rejected; valid `/app/x?d=…` stored relative); inbox eviction at
  INBOX_CAP evicts oldest READ first.
- remix: `builds.create({remixOfAppId})` seeds parent `build.files`, creates a
  NEW app row with lineage + fresh storage scope, consumes trial quota.
- refine: union parse incl. `similar` present/absent on both variants;
  hallucinated `similar.slug` filtered against real listed apps.
- explore: sort=top orders by `_plays:total`; search ILIKE hits name AND
  description; oversized/invalid `?d=` dropped, valid payload delivered as
  `launch` via `app.context` (envelope test).
- builder: output-contract parser (manifest+code extraction, malformed cases);
  fixture-stubbed end-to-end build (tip-jar, no LLM) writes a servable bundle to MinIO.
- template (skill-CI): every `skills/*.md` exemplar bundles via `Bun.build`
  (catches dep resolution + version drift; assert main.js < 2.5MB); plus the
  `skills/fixtures/*.json` specs each pass ONE real agent build pre-kickoff.
- builder: submit rejects code referencing nonexistent `./assets/` files;
  generate_image respects the 4/build cap and degrades without FAL_KEY.

| What | Verify how |
|---|---|
| typecheck/lint/test/build | locally, every milestone |
| bridge + iframe loop | locally once (M3, browser) |
| login, payments, World live, ENS live | on dev.superjam.fun after push |
| full demo script | on dev, then prod promote |

---

## 20. Milestones (one-shot order, each ends green + committed)

- **M0 scaffold** — workspaces, turbo, catalog, shared (env/typeid/SERVICE_URLS/
  constants/bridge schemas), db schema + first migration (incl. `category`/
  `remixOfAppId` columns, `app_message`, `msg` prefix, `social` capability,
  message/deeplink constants — all near-free here, painful later; +0.5h),
  docker-compose, logger, lint/typecheck config, README. ✓ gate passes;
  `db:generate` produced SQL.
- **M1 server core** — Hono + oRPC mount, Dynamic JWKS context middleware
  (test seam: tests mint JWTs against a local JWKS), health, error map.
  ✓ auth tests.
- **M2 storage/data/counter/messages** — bridge routers + quotas + ownership +
  cursors; `bridge.messages.send/list` + rate caps + `inbox.list/markRead`
  (+1.5h). ✓ pglite tests above incl. messages.
- **M3 sdk + bridge + template** — SDK.md written (INCLUDING the messages/
  share/launch sections — not retrofitted at M5); child client incl.
  `messages.*` + `share.link` + `launch` in context; host bridge lib;
  app-template + theme.css + both examples + **the games batteries: lib/sfx +
  lib/game + the skills/ registry (5 skill files + INDEX) + game theme
  classes (port from the PoC — written and validated there 2026-06-12,
  +1h)**; `/a` serving from MinIO with the
  `_plays` bump on index.html (+1h); manual browser check: tip-jar exemplar
  runs in sandboxed iframe via real Dynamic login (localhost allowlisted),
  storage + counters round-trip.
  ✓ envelope tests + 3D-exemplar bundle test. **Riskiest milestone — do not defer.**
- **M4 web shell** — all §2 routes incl. the Reviews panel (reviews router +
  pglite tests land here too — CRUD is trivial once §7 exists), Dynamic
  provider,
  explore (search/sort/chips/counts via `apps.explore`), viewer + confirm sheet
  + Remix button + Recipe panel + `?d=` parsing,
  `/inbox` + header badge, /me, /build UI (+3h — build the cosmetic chunks,
  explore polish and the recipe panel, LAST within the milestone).
- **M5 builder + ai proxy** — refine stage (generateObject union + wizard UI),
  then the pipeline: **fixture-stubbed e2e test first** (tip-jar, no LLM),
  then **oneshot** (whole loop green), then **remote/agent** (Agent SDK +
  submit tool + PreToolUse path gate + events feed); iterate; **remix** (wizard mode + `remixOfAppId` plumbing
  through refine/create + parent-files seeding — reuses the iterate path);
  **similar-check** (catalog injection + union extension + wizard card)
  (+3h together); FIFO concurrency cap; icon route; `bridge.ai.chat`
  proxy + quota (SDK.md teaches `sdk.ai`).
  ✓ fixture e2e test + submit-tool validation tests + AppSpec/refine union
  parse tests (incl. `similar`) + remix seeding/lineage/quota tests +
  path-gate test (absolute path outside workspace → denied);
  live: one real agent build on dev through the remote builder (§11 — repoint
  the `turbojam-builder` unit at this repo's `apps/builder` first).
- **M6 onchain payments + pots** — onchain pkg, public rail (publish-fee +
  pot stakes on Base Sepolia), usdcBalance; **gasless EIP-3009 relay**
  (`payments.relay` route + `signTypedData` in `useSignAndSend`, §13/§15.1);
  **privacy rail** (Unlink browser client + server auth routes + the payUSDC
  adapter with public-tip fallback, §15) + **top-up button** (`profile.topup`,
  both rails, §15.1) (+3-4h; cut order WITHIN M6: privacy rail cut FIRST —
  flip = public tips, drop the nanopayments submission; top-up + sponsorship
  survive); **sdk.pot** (escrow = agent server
  wallet; stake receipt verify; pro-rata payout job; **AI-oracle resolve**
  (resolver:"ai" → Gemini search-grounded sweep + auto-payout, §11);
  +4-5h — internal cut: ai-resolve (creator-resolve survives) → void/refund
  path → deadline → cut pot entirely, market.md falls back to the settle-up
  recipe) + **payments.mine** (≈0.5h, the trustworthy-paywall primitive).
  ✓ publish tests + pot tests (stake receipt validation, pro-rata payout w/
  mock viem, double-resolve rejected, non-creator → Forbidden; ai-resolve
  picks a valid option|null w/ mock Gemini; creator override of an ai-pot;
  payout idempotency across sweeps via paidOutTxHash); live tx on dev.
- **M7 ENS** — durin mint step (incl. `app.category` + `app.remixOf` setTexts)
  + listFromEns (resolves them too; backs the chain-sourced feed) + inline
  name-tag/remix → Basescan links (NO source toggle — §16) + /manage retry (+0.5h).
- **M8 World + agent marketplace** — rpContext/verify live + trial quota UI;
  the marketplace (§14): builder_agent table/router, `/agents` page, wizard
  agent picker, paid-dispatch verification, agent ENS mint, demo seeding
  (second registry row) (+3-4h). Also the **gated `sdk.payments.payX402`
  leg** (§9/§15 — builds on the M6 Unlink adapter + adds Circle Gateway;
  +2-3h) — the nanopayments prize-complete 4th tech. Internal cut order:
  **payX402 (cut FIRST — private tips already carry 3-of-4)** → x402
  platform→builder → per-agent ERC-8004 + reputation → per-agent ENS mint →
  paid builds — the free-agent registry + dispatch is the LAST thing cut.
- **M9 deploy** — Dockerfiles, Caddyfile, railway.tomls, push dev, smoke the
  demo script on dev.urls.

Stretches after M9, in order of demo value:
- **S1 realtime** — `data.subscribe` per §9 (TJEvent + one host WS + in-process
  pub/sub; no Redis). Live-updating leaderboard while judges tip = the Quick
  multiplayer-joy factor. ≈2-3h.
- **S2 builder-protocol docs** — `packages/sdk/SKILL.md`: how any external
  agent implements the §11 builder protocol + registers on `/agents` (the
  `quick init` move; the old open-deploy endpoint is absorbed by the
  marketplace — a registered agent IS the open deploy path). ≈1h.
- **S3 prize stretches — GATED on the kickoff rules check** (only if projects
  may submit to >3 sponsors): **Walrus bundle storage** (Sui $3K new-build:
  after S3 upload, also publish the bundle via the Walrus HTTP publisher API →
  blob id in an `app.walrus` text record at ENS mint; bundles on decentralized
  storage + catalog on ENS = apps fully platform-independent; ≈2-3h, workshop
  Fri 3:30 PM) / Arc port (2h timebox) / IPFS contenthash + .limo. If the
  3-sponsor cap is real, Sat evening goes to demo polish + seeding the
  marketplace gallery instead. **Seeding list (one per archetype, wholesome):**
  a World-Cup match pot (self-resolving via ai, "friends call the final"), a
  penalty-shootout 3D game, an AI-graded drawing/photo contest, a CSV/data
  explainer (attach a spreadsheet), a trivia duel with invite, a tip-jar.

Cut order if behind: stretches never start → `payX402` (the gated Circle
Gateway leg, §9 — cut first; private tips still cover 3-of-4 for the
nanopayments track) → privacy rail → public-tip fallback (the §15 adapter
already does this on error; cutting it just means not wiring Unlink — tips go
public, nanopayments submission drops) → explore
search + sort tabs (keep category chips + play/remix counts on the grid) →
similar-check entirely (the
union field stays specced; zod `.optional()` = zero code debt) → AgentKit
surface (keep World ID) → remix lineage UI + Recipe panel (keep remix
mechanics + the ENS `app.remixOf` record — the prize story survives on chain)
→ review TEXT field (keep ★ ratings — the World story + aggregate survive at
half the UI) → ENS toggle (keep mint) → data update/delete (keep insert/list/counters) →
share.link/launch deeplinks LAST of the new features (it's the demo beat —
without it the invite degrades to "check your inbox").
NEVER cut: `messages.send/list` + `/inbox` (PoC-proven ≈2.5h, simultaneously
the World-ID spam story and the demo beat) and play counts (≈30 min).
`sdk.ai` is core (M5) — it's ≈1-2h and it's the "apps are themselves
AI-powered" differentiator.

---

## 21. Human schedule (36h)

Fri PM: kickoff checks (§3⚠), ENS workshop 5:30pm, M0–M2, Railway skeleton up.
Sat AM: M3–M4 (bridge is the morning). Sat PM: M5–M7 + M8. Sat eve: M9 +
stretches, **feature freeze 01:00**. Sun AM: arch diagram (reuse §6), 3-min
video, README polish, **submit before 09:00**, ENS booth. Fallback for judging:
pre-built mini app + pre-recorded build clip.

---

## 22. Demo script (3 min)

0. **Open with the make**: in the **Make** tab type *"a tip-jar game"* → 2–3
   follow-up chips appear, tap them → **the plan** appears ("here's what's
   inside your jam") → choose the house builder → leave the **workshop**
   running in a corner (the jam's UI paints itself in — no build logs, no
   "AI" on screen) while showing the rest of the platform. (Vocabulary on
   screen is "make / jam / workshop", never "build / app / agent".)
1. Email login → wallet exists under the hood (no seed phrase). Say the gas
   line out loud: "this wallet will tip, publish, and stake — and it never
   holds ETH — every payment is a signed USDC authorization our agent relays
   (EIP-3009, no gas token)" (§15.1).
2. Open a community mini app → tip via `sdk.payments.payUSDC` → **host** confirm
   sheet ("Send 0.50 USDC privately 🕶") → Unlink shielded transfer on Arc;
   leaderboard updates (server-stamped, ✓-human badges). The line: **"tips are
   confidential by default — pull up Arcscan, there's nothing linking me to
   the recipient; the leaderboard is the only thing that shows it, because I
   chose to tap."**
3. Return to the build — done: deployed, playable, minted as
   `tipjar.kris.superjam.eth` on Base Sepolia (Durin L2) **under the user's
   OWN agent-minted ENS namespace**; show the Basescan tx from the agent's
   wallet. (Roadmap line if a judge probes: "our web domain `superjam.fun` can
   be DNSSEC-imported into ENS so the name IS the URL — one namespace for URLs,
   payments, and agents; we ship on `.eth` for the testnet event, §16.")
3b. **Remix + challenge (the spread moment; second phone pre-logged-in).**
   Tap **Remix** on a listed game — wizard opens pre-filled: *"Based on
   <game> by @maria — your changes:"* → type *"loser tips the winner
   0.5 USDC"* → the agent extends the original's public recipe and builds a
   NEW app **seeded from the original's code** (≈40s), minted with an
   **`app.remixOf` record pointing at the parent — remix lineage, on chain**.
   Open it, hit *"Challenge a friend"* → the app mints a deeplink
   (`sdk.share.link`) and drops it in @judge's inbox (`sdk.messages.send`).
   **Switch phones**: inbox shows *"kris challenged you"* → tap **Open** →
   lands inside the match, payload already loaded. Apps aren't just AI-built —
   they're remixed, shared, and spread between verified humans. (Time
   permitting: run this remix through the PAID community agent from `/agents`
   — "I just paid another human's AI 1 USDC to build this.")
4. World ID verify (device, live) → **tap "Top up"** ($5 USDC seeded to both
   rails — "in production this is a card on-ramp; here it's World-gated so
   it can't be farmed") → pay 1 USDC publish fee (public, the platform must
   verify the receipt) → app flips to listed. **Judge phone: leave a ★ review**
   — "every review on SuperJam is one-per-verified-human; you can't astroturf
   this app store." Tap the jam's **name tag → Basescan** (chain facts are
   inline, no toggle) — "the catalog is rebuildable from these records alone;
   delete our database and Discover still renders."
5. Open the fresh app, send a tip. **Built by a named AI agent, named on ENS,
   paid in USDC, used and ranked by verified humans.**

Q&A ammo: apps can hold ESCROWED WAGERS settled by the platform agent
(sdk.pot — Dynamic server wallet custodies + pays out, only verified humans
stake/resolve); the AI-graded drawing contest is the alt demo beat if the
remix beat runs long. A `resolver:"ai"` pot can resolve ITSELF from live data
and auto-pay (Gemini search-grounded sweep, §11) — a World-Cup-match pot that
settles onchain the moment the match ends, no human in the loop. Generated
apps can themselves call `sdk.ai` (a fortune-teller, an AI dungeon master, a
"grade my dance" judge) — apps are AI-powered, not just AI-built. The build in step 0 can
be a **3D game** ("build me a gem-clicker in 3D") — full r3f scene with sound
+ confetti from one prompt in ≈60s, PoC-proven. And the World line:
"what breaks without World ID" now has three answers — spam apps, fake
leaderboards, and infinite remix/inbox spam from sybils. Comp line: Shopify's
Quick went viral this week proving these primitives inside a corporate trust
bubble; SuperJam is the same set on the open web — World ID is our IAP, the
sandbox is our firewall, and the wallet adds what Quick can't: money.
Privacy Q&A: "why are tips private by default?" — *peer-to-peer value has no
reason to be public; the only payments we keep public are the ones WE must
verify on-chain (publish fee, pot escrow). Two rails, one rule."* Custody:
*the user's `unlink1` account is derived from their Dynamic wallet's signature
(non-custodial); a passphrase/WebAuthn-unlocked custodial mode is the
fallback.* Mainnet/cross-chain: *everything's on testnet for the event because
Arc mainnet + Unlink mainnet don't exist yet; production bridges the public
(Base) and private (Arc) rails with CCTP v2.* Nanopayments money shot (slot-3,
if `payX402` shipped): open a jam with an **"unlock premium privately 🔓"**
button → `sdk.payments.payX402` → a private per-call payment to an x402
resource on Arc (Unlink shield → Circle Gateway). *"Jams don't just TAKE
payments — they MAKE private machine payments: pay-per-call, private,
stablecoin, no gas. That's the agentic economy — and it's all four sponsors in
one tap: Dynamic + Unlink + Circle + Arc."* (If `payX402` was cut, this is
pure Q&A; the private tip already demonstrates the lane.)

---

## 23. Pre-event checklist (Wed/Thu — infra only, no project code)

- [ ] Buy `superjam.fun` (the WEB domain — DNS/A-records only; no on-chain
      step needed) AND register **`superjam.eth` on Sepolia ENS** (the ENS
      parent, §16); fund: Sepolia + Base Sepolia test ETH ×2 wallets (user +
      agent), testnet USDC (Base Sepolia + Arc). No mainnet ETH — testnet-only
      event (§15.1)
- [ ] **Register `superjam.eth` on Sepolia + wire Durin (Thu, the ship path):**
      `setResolver` → Durin L1Resolver on Sepolia + `setL2Registry` → Base
      Sepolia L2Registry; resolve a test subname from an L1 client
- [ ] **(Optional §16 upgrade) DNSSEC-import `superjam.fun` into Sepolia ENS:**
      DNS → Cloudflare, enable DNSSEC, DS record; claim on Sepolia's
      DNSRegistrar (NOT mainnet); `setResolver`+`setL2Registry`. Success ⇒
      flip `ENS_PARENT_NODE` to `namehash("superjam.fun")` for the
      "name IS the URL" story; drags/fights Durin ⇒ ship on `superjam.eth`,
      DNSSEC is the roadmap line
- [x] **Builder infra live on kristjan-dev (done 2026-06-11):** systemd user
      unit `turbojam-builder` + `turbojam-caddy` docker (TLS, Let's Encrypt)
      at `https://37.60.232.68.sslip.io`; token in
      `~/.config/turbojam/builder.env`; remote build rehearsed end-to-end
      through the deployed PoC
- [ ] When `superjam.fun` is bought: A record `builder` → `37.60.232.68`,
      swap the Caddyfile hostname (`~/.config/turbojam/Caddyfile`), restart
      `turbojam-caddy`
- [ ] Builder auth green Thu night AND Fri morning:
      `curl https://<builder>/health` → `claudeAuth: true`
- [ ] **Rehearse NESTED Durin subnodes** (user node → app node under it) on
      Base Sepolia — gates the §11 naming scheme; fallback is specced (flat +
      app.owner record) but decide from evidence, not at 2am
- [ ] **Dynamic server-wallet rehearsal (Thu):** create the agent's server
      wallet in the dashboard, sign + send one Base Sepolia tx via
      `DYNAMIC_API_TOKEN` (`@dynamic-labs-wallet/node-evm`); fallback = plain
      key behind the same `packages/onchain` adapter
- [ ] Durin rehearsal on Sepolia/Base Sepolia: factory `0xDddd…d22d`, wire
      L1Resolver `0x8A96…3D61` + `setL2Registry`, mint test subname w/ records,
      confirm resolution from an L1 client
- [ ] Deploy the Durin registry on **Base Sepolia** for `superjam.eth`
      (parent = the Sepolia ENS node, §16); pre-mint `builder.superjam.eth`
- [ ] Read ENSIP-25/26 + the ERC-8004 registry `register()` interface; if
      possible rehearse an ERC-8004 registration on testnet
- [ ] Fri workshops: Sui/Walrus 3:30 PM, ENS 5:30 PM
- [ ] **Do we own a Ledger device? Pack it** — gates the best-odds slot-3
      track ($10K / 5 winners). Also: LI.FI track details at kickoff
- [ ] Dynamic: org + env, API token, **toggle OFF embedded-wallet confirm UI**,
      allowlist localhost + superjam domains
- [ ] **Gasless rehearsal (Thu, gates §15.1):** ONE EIP-3009
      `transferWithAuthorization` relay on Base Sepolia (USDC
      `0x036CbD53842c5426634e7929541eC2318f3dCF7e`): sign with a fresh Dynamic
      embedded wallet (`signTypedData`), submit from the server wallet, assert
      the receipt's Transfer log `from` == the signer. Fail ⇒ the Top-up
      button also drips ETH (§15.1 fallback), zero code-shape change. Also:
      fund the server wallet with Base Sepolia ETH + USDC (faucet.circle.com)
      for relaying + the top-up button
- [ ] **Unlink rehearsal (Thu, gates the privacy rail + slot-3, §3/§15):**
      two `unlink1` accounts; verify Dynamic MPC `personal_sign` is
      deterministic (gates `fromEthereumSignature` derivation — else custodial
      mode); `faucet.requestPrivateTokens` on Arc testnet; one private
      transfer A→B; confirm B sees it + relayed (no gas); a withdraw. FAIL ⇒
      tips stay public (§15 fallback), slot-3 reverts to Ledger/Walrus
- [ ] Booth asks Fri: **Dynamic** — un-gate native `sendSponsoredTransaction`
      relay UX, or is EIP-3009 enough? · **Unlink** — recipient
      note-discovery latency; is Dynamic MPC `personal_sign` deterministic
      (gates `fromEthereumSignature` key derivation, §3)? · **Circle** —
      does Arc-as-chain alone satisfy the nanopayments "all three" rule, or
      is the Gateway/x402 leg required?
- [ ] World: portal app + action `publish-app`; device-verify own phone;
      AgentKit CLI registration; try simulator
- [ ] Arc faucet (faucet.circle.com) daily; one viem tx on 5042002
- [ ] Gemini API key for refine (free); Pinata account (stretch)
- [ ] Railway project + Postgres + bucket provisioned; fill §1 manifest into a
      private `.env` note

---

## 24. Kickoff one-shot prompt (copy-paste at Friday kickoff)

> Create a new public repo `superjam` (init on branch `dev`, plus empty `main`).
> Copy this spec into it as `SPEC.md`. Implement it end to end following the
> one-shot protocol in §0: milestones M0→M9 in order, gate green after each
> (`bun run typecheck && bun run lint && bun test && bun run build`), one commit
> per milestone minimum, push `dev` after M3, M5, M7, M9. Here is the filled
> required-inputs manifest (§1): [paste .env values — missing rows are fine,
> mock modes cover them]. Note: the builder service (`apps/builder`, §11)
> deploys to THIS machine, not Railway — the PoC's `turbojam-builder` systemd
> user unit is already running here; when M5 lands, repoint the unit at this
> repo's `apps/builder`, swap the Caddy upstream to :4710, and restart it.
> The four discovery/social features (explore, similar-check, remix,
> messaging + deeplinks) are CORE spec, not stretches — they're folded into
> M0–M7 per §20. The open builder-agent marketplace (§14) is CORE, folded
> into M8. The PoC at ~/code/turbojam-poc holds the VALIDATED template
> assets — at M3, PORT (don't rewrite) `packages/app-template` (skills/,
> src/lib/, theme.css game classes, SDK.md adapted to the §9 contract).
> Start with M0. When all milestones are done, print
> the verification matrix (§19) with the status of each row and the list of
> `// SPEC-GAP:` comments you left.
