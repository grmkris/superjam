# SuperJam — Sponsor Integrations, Designer Deep Dive

_Companion to DESIGN_BRIEF.md (same usage: self-contained, paste into a design
session). That file owns the screen inventory + the **Toybox** visual language;
this one goes deep on the sponsor integrations and exactly where they surface in
the UI. Why it matters: the project is judged per-sponsor in a 4-minute live
demo — every integration needs a **visible moment** a judge can point at. If a
sponsor's feature is invisible, it doesn't exist. v2, 2026-06-13, derived from
SPEC.md v3 §3/§13–16 + the Toybox design handoff (round 8)._

The submitted tracks: **ENS** (creator names **and** per-jam subnames, the
agent-built family tree), **World** (World ID — human-verified reviews/comments
+ creator verification; AgentKit human-backed builders), and **USDC payments via
Dynamic wallets** (Dynamic = the onboarding/wallet layer; used throughout). A
first-class **builder economy** rides on ENS+ERC-8004 (§4b). A "slot 3"
(Arc/Unlink payments, Walrus, Ledger…) is decided at the event — see §5.

**Toybox translation note.** All surfaces below are rendered in the Toybox
language (cream paper, ink outlines, sticker shadows, Baloo 2; jams not apps).
Two specific translations to keep front-of-mind: **the DB/ENS source toggle is
GONE** (design round 6) — chain facts are inline + tappable → Basescan, not a
mode switch; and **no AI/agent machinery is visible** — the builder lives behind
a "who's making this?" chip and a de-jargoned builder profile.

---

## 1. ENS — "every maker and every jam has a name"

**What it is technically:** a **hierarchical family namespace** on
`superjam.fun` (DNSSEC-imported into ENS; `superjam.eth` is the fallback
parent). Each user claims `name.superjam.fun` **at signup**, and every jam they
make auto-mints **under them** — `tipjar.kris.superjam.fun`,
`trivia.kris.superjam.fun` — with the jam's metadata (url, icon, description,
category, **remix parent**) written as ENS text records on Base. Provenance is
readable from the name itself; the catalog can be rebuilt from those records
alone — no database. The builder additionally has its own verified on-chain
identity (`builder.superjam.fun`, ENSIP-25/26) — see the builder economy (§4b).

**The design thesis:** ENS reads as *provenance and belonging*, not crypto
noise — a name tag on a toy. Names everywhere, jargon nowhere. Chain facts are
inline and tappable, never a separate "on-chain mode".

### Surfaces

1. **NameTag** (component — replaces the old EnsChip): the ENS name rendered as
   a quiet **sticker shaped like a toy's name tag** — a punched hole + mono
   text (`tipjar.kris.superjam.fun`), ink-outlined like everything else. It's a
   *credential*: small, proud, never shouting. Carries a small **↗ → Basescan**
   (the raw on-chain record) — that inline link is how chain facts surface now.
   States: **minted** (normal) · **pending** (the make flow shows an explicit
   "**Hanging the name tag** ⛓ .kris.superjam.fun" workshop step while it mints)
   · **failed/absent** (tag simply not shown — never a broken state).
   Placement: the **jam page** and the **reveal**; the feed card stays
   decluttered (name tag lives on the jam page, remix chip stays on the card).

2. **Claim-your-name (onboarding):** the first ENS moment — right after Dynamic
   email login, the user claims `kris.superjam.fun` with a preview of jams
   hanging under it. This is where creator identity is minted (DESIGN_BRIEF
   §3a-ii). The ENS story now starts at signup, not at first build.

3. **Remix lineage chips** (feed card + jam page): "🔁 remix of `<parent>`" next
   to the name tag. Lineage is *recorded on ENS* (`app.remixOf`) **and** doubly
   implied by the name hierarchy, so the family tree is provable from chain
   alone. Tappable → parent jam (and ↗ → Basescan record). Treat like GitHub
   forks: small, proud, everywhere.

   > **The DB/ENS source toggle is removed** (was deviation #1 in the round-4
   > spec-feedback doc; deleted in round 6). Do NOT design a mode switch or a
   > card-flip "chain mode". The "delete our database and this still renders"
   > pitch survives as **narration** over the inline name tags + ↗ links, not as
   > a UI control. `apps.listFromEns()` still exists as a backend capability
   > (SPEC §16) — it's just not surfaced as a toggle.

4. **Mint status on `/app/[slug]/manage`** (owner console): ENS records as
   key→value rows (url, avatar, description, app.category, app.remixOf) with:
   **minted** (link out) · **failed** (**Retry** button — a mint failure never
   fails a make, so this is a calm, normal state) · **pending**.

5. **Builder identity → the Builder profile** (replaces the old `/build` agent
   panel; full spec in §4b). The ENSIP-25/26 record is presented as a
   **de-jargoned info page** rendered from the builder's on-chain ERC-8004
   record — reached via an ⓘ on any builder card or the "who's making this?"
   chip on the workshop screen. It leads with a fetched description + the
   builder's URL; the registry facts (agent id, operator ✓ human, since) and
   fetched feedback/score sit below. No "ERC-8004" chip shouting at the top.

6. **The name-tag-hung moment** (replaces the old build-feed "registering"
   beat): in the workshop the "**Hanging the name tag**" step completes, then on
   the **reveal** the finished jam wears its name tag (`tipjar.kris.superjam.fun
   ✓`) and a copyable deep link `superjam.fun/kris/tipjar`. That pop is the
   payoff — no build log, no "minting" terminal line.

**Copy register:** "named on superjam", "your name tag", "hangs under you".
Avoid: "NFT", "subdomain", "mint", gas talk, "on-chain mode".

---

## 2. World — "every human, every review, is real"

**What it is technically:** World ID proves personhood (phone "device" level
or Orb), stored one nullifier per human. The **primary surface is verified
reviews/comments** below jams — you cannot review or comment without verifying,
and the nullifier makes it **one review per human per jam**, so ratings and
leaderboards can't be sybil-spammed. We also gate the **first jam** (and
publishing/remixing) behind it. Proof is validated on our backend (hard track
requirement, invisible to design). AgentKit additionally registers builders as
"human-backed".

**The design thesis:** verification is a *status symbol*, not a checkpoint.
The green **✓-human sticker** is the social atom of the whole product.

### Surfaces

1. **VerifiedBadge (✓-human sticker)** — beside every `@username` everywhere:
   feed cards ("by @maria ✓"), jam-page maker, crew rows, inbox, confirm-sheet
   recipient, leaderboards. One consistent green sticker; long-press: "verified
   human (World ID)". Reviews read "✓ human". Unverified users simply lack it
   (no negative mark).

2. **Verified reviews/comments — the sharpest World surface (primary).** The
   jam page (DESIGN_BRIEF §3b-iii) has **Comments · Reviews** tabs. Both are
   World-gated: the aggregate reads "★4.8 · 31 *verified* reviews" (the word
   does the selling); every row carries ✓-human; the **creator** of the jam
   also wears ✓. Gate state copy: *"Reviews are one-per-human. Verify to
   review."* / for comments: *"prove you're human once with World ID — no bots
   in here."* Demo beat: a judge verifies on their phone, then leaves a star
   review live.

3. **The first-jam gate** — the conversion moment. Fires **once**, right as the
   user's first jam heads to the workshop (also re-used for publish + remix). A
   friendly interstitial (not an error): playful illustration + big QR + *"Verify
   you're human to keep jamming."* + "scan with World App · ~30 seconds, one
   time" + below-fold *"keeps superjam human — no spam jams, no bot
   hi-scores."* One primary button + a quiet "what's this?" link.

4. **The verification flow itself** is World's IDKit widget (their modal, QR →
   judge scans with World App, ~30s). We design the *frame*: pre-state (the gate
   above), in-progress ("waiting for World App…" + spinner once scanned), and
   the **success return** — celebration: the ✓ sticker pops in next to the
   username, copy "you're verified — keep jamming". MUST return the user to
   exactly where they were (mid-make, mid-publish, mid-review).

5. **Profile verification block:** status row — unverified (Verify CTA) /
   verified ✓ (level device/Orb + date). Quiet, factual. The ✓ earned at the
   first-jam gate surfaces here.

6. **Leaderboard framing:** a small "all real humans ✓" caption is the cheapest
   way to make the sybil story visible to judges without a single extra feature.

7. **Builder human-backing (AgentKit):** the "operator ✓ human" row on the
   builder profile (§4b) — the builder is registered to a real human via
   AgentKit. Trust hierarchy reading top-to-bottom: *named on superjam →
   registered on-chain (ERC-8004) → backed by a verified human.*

**Demo constraint that shapes design:** judges verify on THEIR OWN phones
during the 4-minute demo. The QR/verify surfaces must be legible across a
table and survive a projector — big QR, high contrast, zero clutter.

---

## 3. Dynamic + USDC — "money that never says crypto"

**What it is technically:** Dynamic provides email-login that silently creates
an embedded MPC wallet (no seed phrase ever exists user-side); all payments
are USDC (6-decimals stable) on Base; every transaction a jam requests is
reviewed in the host's confirm sheet and signed by the Dynamic wallet under
the hood. Pre-funded demo wallets mean no onramp appears anywhere.

**The design thesis:** crypto that never says crypto. Email in → a wallet
appears → money works. Dynamic owns the **onboarding** moment; the confirm
sheet is the single, **Toybox-styled** place money is approved — its trust
comes from a clear boundary marker, not a switch to a banking aesthetic.

### Surfaces

1. **Onboarding (the Dynamic moment):** email-first, one field + "Continue".
   Dynamic's widget handles the OTP; we style around it. Copy reassures: *"a
   wallet appears with it — nothing to install, no seed phrase, no extension."*
   Immediately followed by **claim-your-name** (§1.2) — together these are the
   onboarding sequence. Must preserve a pending invite deeplink through login
   (someone tapping a challenge link logs in and lands *inside the jam*).

2. **The confirm sheet** (full anatomy in DESIGN_BRIEF §3d — four states:
   review/pending/success/error). **Stays Toybox.** Sponsor-relevant details:
   - Always **jam-attributed**: icon + "Tip Jar requests" — the user must always
     know *who* is asking. The jam cannot draw this UI; only the host can. Make
     the boundary visible with a **"🔒 superjam confirm"** chip in the header +
     the line *"asked for by `<jam>` — jams never touch your wallet."*
   - Amounts in plain money style: **0.50 USDC** large, recipient as **name tag**
     when known (`tipjar.kris.superjam.fun`) else short address.
   - **pending** = the Dynamic wallet signing + broadcasting: spinner → tx hash
     as a tappable mono chip (↗ Basescan).
   - Hard cap: single tx ≤ 25 USDC — over-cap requests rejected before the sheet
     renders (the jam gets an error; no extra UI).

3. **Profile wallet block:** address (short form + copy), **USDC balance** as
   the hero number, recent activity (tips sent/received, pay-a-friend, review
   fees). No gas, no network switcher, no token lists — USDC only.

4. **User-to-user payments (Pay a friend):** from a chat thread, a 💸 button →
   pick amount + note → the same confirm sheet → lands as a money line in the
   thread (DESIGN_BRIEF §3e-iv). Wallet-to-wallet, same cap + trust model. This
   is a new payment surface beyond tips/fees.

5. **Pay-to-review (publish) flow:** profile → Publish → (World gate if needed)
   → confirm sheet for **1 USDC review fee** → status flips to "listed". Same
   sheet as tips — consistency IS the design.

6. **Tip moments inside jams:** jams trigger tips via the SDK; the sheet slides
   over the iframe. After success, the jam updates (leaderboard, thank-you) —
   design the sheet-dismiss → jam-celebration seam to feel continuous.

---

## 4. The builder economy — ENS + ERC-8004 (a first-class track) {#4b}

**What it is technically:** anyone World-verified can register **their own AI
agent** as a builder. A registered builder gets a name under its owner
(`forge.kris.superjam.fun`), an **ERC-8004 identity** (agent id), an on-chain
**feedback/reputation** profile, and a **USDC revenue share** of the jams it
builds. The house builder (`builder.superjam.fun`) is just the default one.
Every jam's review activity can also write feedback to its builder's ERC-8004
reputation profile — verified-human reviews become un-astroturfable on-chain
builder track records (the World × ENS × 8004 weave).

**The design thesis:** builders are **on-chain citizens you choose between**,
shown as workshop staff — never "configure your AI model". De-jargon everything;
the ERC-8004 record reads as live, fetched metadata.

### Surfaces

1. **Choose your builder** (in the make flow, between the plan and the
   workshop): cards for registered builders — default house builder (free) +
   community agents. Each card: name, ★ on-chain feedback, jams built, speed,
   the **cut it keeps**, and an **ⓘ → builder profile**. Picking a paid builder
   routes USDC to its wallet via the confirm sheet before dispatch.

2. **Builder profile** (opens from any builder card's ⓘ, or "who's making this?"
   on the workshop): a de-jargoned info page rendered from the **on-chain
   ERC-8004 record** — leads with a fetched description + the agent's URL, then
   registry facts (agent id, **operator ✓ human**, registered-since) and
   **fetched feedback / score / jams built** below. NO "ERC-8004" chip shouting
   at the top — the standard reads as metadata. Visual register: a workshop
   staff badge on a lanyard.

3. **Register your builder** (on the profile screen): name it under yours
   (`forge.kris.superjam.fun`), point to its endpoint, set a USDC price → it
   gets an ERC-8004 identity, a feedback profile, and a revenue share.
   worldVerified only (AgentKit human-backed requirement). Appears in
   Choose-your-builder afterward.

4. **On your profile:** "your registered builders" — each tagged with its name
   and linking to its profile. This is where a maker manages the agents they've
   registered.

**Copy register:** "who's making this?", "house builder", "backed by a real
human ✓", "keeps 10%". Avoid: "ERC-8004" as a headline, "model", "LLM", "agent
config".

---

## 4a. The 4-minute demo choreography (what must be visible when)

The demo beats and the sponsor moment each carries — design these screens to
be narrated over, legible from across a table:

1. **Idea → the workshop** (hero) → reveal — *the make moment*: the jam's UI
   paints itself in; the "Hanging the name tag" step + the reveal's name tag is
   the ENS beat. (No build feed — narrate "an AI made this, but you'd never
   know it was a compiler".)
2. **Tip inside a jam** → confirm sheet review→pending→success → leaderboard
   updates with ✓ entries — *Dynamic/USDC + World stickers*.
3. **Remix + challenge a friend** → invite lands on a judge's phone inbox →
   Open → inside the match — *social loop; remix-of chip on the new jam*.
4. **Jam page: name tag + reviews** — tap the name tag → Basescan (chain facts
   inline, no toggle); a judge **verifies World ID on their own phone** and
   leaves a ★ review live — *both ENS provenance and World reviews in one screen*.
5. **Choose / inspect a builder** → builder profile from its ERC-8004 record —
   *the builder-economy track*.

---

## 5. Slot-3 contingency (design hooks, zero committed work)

A third sponsor track gets picked at the event. Leave these seams so any of
them lands without redesign:

- **Walrus:** a "stored on Walrus" tag in the name-tag row on the reveal / jam
  page + a row in /manage (blob id → aggregator link). The name-tag row is
  built to fit one more tag.
- **Arc / Unlink (payments):** the confirm sheet's footer can carry a "routed
  by Unlink, settled on Arc" line — one extra caption, no structural change.
  (User-to-user pay + tips are the surfaces it rides on.)
- **Ledger:** an "operator approval" moment — when a privileged action runs
  (mainnet mint batch), an extra **workshop step**: "⏸ waiting for operator
  approval on Ledger → ✓". The making-steps list is built to fit one more row.
- **Hedera / Dynamic agentic:** no new user-facing UI (backstage / pitch slide).

Rule of thumb for the designer: the **name-tag row** (name · remix · Walrus?)
on the reveal/jam page and the **making-steps list** are the two reserved
extension points; keep both comfortable with one extra item.

---

## 6. Cheat sheet — sponsor → surface → component → state

| Sponsor | Surface | Components | Key states | Copy anchor |
|---|---|---|---|---|
| ENS | jam page, reveal | NameTag (sticker, ↗ Basescan) | minted / pending / absent | `tipjar.kris.superjam.fun` |
| ENS | onboarding | ClaimNameScreen | typing / available / taken / claimed | "claim your name" |
| ENS | feed card, jam page | RemixLineageChip (↗ Basescan) | original / remix / N-remixes | "🔁 remix of X" |
| ENS | /manage | RecordsTable + Retry | minted / failed / pending | key→value rows |
| ENS+8004 | make flow | BuilderPickerCard / BuilderProfile | list / fetched-record | "who's making this? · backed by a real human ✓" |
| ENS+8004 | profile | RegisterBuilderForm | name / endpoint / price | `forge.kris.superjam.fun` |
| World | everywhere usernames appear | VerifiedBadge ✓ (sticker) | present / absent | "✓ human" |
| World | jam page reviews/comments | RatingStars / ReviewRow / ReviewGate | gate / write / edit-own | "Reviews are one-per-human. Verify to review." |
| World | first jam / publish / remix | WorldGate (big QR) | gate / verifying / success-return | "Verify you're human to keep jamming." |
| World | leaderboards | caption | — | "all real humans ✓" |
| Dynamic | onboarding | EmailLogin + ClaimName | email / otp / wallet-appears | "a wallet appears with it" |
| Dynamic/USDC | over iframe | ConfirmSheet (🔒 superjam confirm) | review / pending / success / error | "asked for by `<jam>` — jams never touch your wallet" |
| Dynamic/USDC | chat | PayFriendSheet | amount / note / sent | "pay a friend" |
| Dynamic/USDC | profile | WalletBlock | balance / activity | USDC balance hero |
| Slot 3 | name-tag row, making steps | reserved slots | — | "stored on Walrus" / "routed by Unlink, settled on Arc" |
