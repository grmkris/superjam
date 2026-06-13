# SuperJam — Design Brief

_Self-contained design input. Paste this whole file into a Claude design
session (claude.ai or Claude Code's frontend-design skill); no repo access
needed. v2, 2026-06-13, derived from SPEC.md v3 + the **"Toybox"** design
handoff (8 rounds in Claude Design) — if the two conflict, SPEC wins on
behavior, this file wins on look/feel. **Companion:** DESIGN_SPONSORS.md goes
deep on the sponsor integrations (ENS / World / Dynamic+USDC + the builder
economy) — paste it alongside this file when designing any screen they touch._

_**Direction: Toybox.** Light, playful, hand-made — cream paper, chunky ink
outlines, hard "sticker" shadows, candy primaries, Baloo 2. Apps are **"jams"**.
The making process reads like a **toy workshop**, never a compiler — no build
logs, file names, terminals, or "AI/agent" talk anywhere a user can see. This
supersedes the earlier dark-first "TurboJam" look._

## 1. What SuperJam is

SuperJam is a super-app host for the open web. Users log in with email and get
an embedded crypto wallet automatically (no seed phrase, ever visible) and
**claim their name** (`kris.superjam.fun`) at signup. From a one-line prompt,
a **jam** — a mini app or game — gets made and deployed in under a minute;
jams run inside sandboxed iframes and get wallet, identity, storage,
leaderboards, AI, and messaging through an injected SDK — zero backend. Every
jam is named on ENS **under its maker** (`tipjar.kris.superjam.fun`), every
human is verified by World ID, and money moves in USDC through a host-rendered
confirm sheet. Discovery is a **TikTok-style vertical feed** of jams you can
play right there — not an app-store grid. (The thing being made is built by an
AI under the hood, but the user never sees that machinery — they see a workshop
making their jam.)

**One-liner:** *"Quick for the open web, with money."* (Shopify's internal
"Quick" tool proved this primitive set inside a corporate trust bubble;
SuperJam is the same move in public.)

**Context that shapes the design:** this is a hackathon demo judged live in
4 minutes, partly on phones (judges verify World ID on their own devices and
receive challenge invites on a second phone). It must read instantly from
across a table.

## 2. Brand & voice — "Toybox"

- **Personality:** a toy workshop, not a dev tool. Playful, hand-made, tactile.
  Everything looks like a sticker you could peel off. Energy and motion in
  make / discover / remix. The confirm sheet stays **on-brand Toybox** (NOT a
  cold banking surface) — its trust comes from a clear boundary marker, not a
  change of visual language (see §3d).
- **Light-first, hand-made.** This is the core flip from the old direction.
  - **Palette:** paper background `#E9E9EE`; cards cream `#FFF4E3` / white
    `#FFFFFF`; **ink** (all outlines + body text) `#221A33`; muted text
    `#6B6478`. Candy primaries: pink `#FF4D6D`, yellow `#FFC940`, green
    `#2FD180`, blue `#4D7CFF` (darker variants `#E8A300` / `#1F9D5F` / `#1A5C38`
    for text-on-color and accents).
  - **Outlines:** chunky **2px solid `#221A33`** on cards/buttons/chips
    (1.5px small, 2.5–5px for hero elements). This ink outline is the signature.
  - **Shadows:** hard offset **`0 3px 0 #221A33`** (no blur) — the "sticker"
    pop. Buttons press down on `:active` (`translateY(1px)`).
  - **Type:** **Baloo 2** (rounded display, weights 500–800) for everything
    user-facing; **ui-monospace** only for ENS name tags and raw chain records.
  - **Radius:** generous, toy-like (≈14–18px).
- **Mini-app theme matches.** Jams ship with a **Toybox** theme.css (same CSS
  var names `--bg --card --text --muted --accent --radius` the SDK contract
  needs, Toybox values) so a generated jam looks like it belongs in the host,
  not a dark iframe pasted into a light shell. (§3f, §7.)
- **Copy register:** short, warm, lowercase-energy, jam-flavored. "Make a jam.
  Share the jam." "Making your jam…", "swipe for the next jam", "jams never
  touch your wallet". Trial gate: *"Verify you're human to keep jamming."*
  Remix gate: *"Remixing is making. Verify to keep remixing."*
- **Hide the machinery.** No build logs, file names, terminals, code, or
  "AI"/"agent"/"compiler" language anywhere a user sees. The make flow is a
  workshop ("Shaping the jar", "Fitting the coin slot", "Hanging the name tag").
  Where the old direction made *watching the agent work* the hero, Toybox makes
  the hero **watching the jam's UI paint itself in** — a live visual preview,
  not a stream of tool events.
- **Identity everywhere:** `@username` + a green **✓-human sticker** (World ID
  verified) is the social atom. Jams show "by @maria ✓"; reviews read "✓ human";
  leaderboards caption "all real humans ✓". ENS names render as a quiet
  **name-tag sticker** (punched hole + mono text), not a plain chip (§5).
- **Mobile-first** (jams feel like phone apps); the 4-min judge demo runs on a
  laptop + two phones: big tap targets, states legible at a glance, no
  hover-only affordances, high contrast that survives a projector.

## 3. Screen inventory (every screen, every state)

**Navigation model.** Three bottom tabs — **Make · Discover · Inbox** —
Toybox-styled (chunky, sticker-pop, the active one popped up). Discover is the
default landing after onboarding. Profile + crew are NOT tabs: they live behind
a `@kris ▾` chip in the top corner. Canonical first-run order: **Welcome →
Discover → Make → Inbox**, with money + sponsor moments threaded through.

### 3a. Welcome / onboarding (Dynamic)
- **3a-i Email → wallet appears:** one email field + "Continue". After login,
  copy reassures: *"a wallet appears with it — nothing to install, no seed
  phrase, no extension."* No wallet jargon, no crypto talk. (The email
  placeholder should read like plain text, e.g. `your email…`.)
- **3a-ii Claim your name:** right after email, claim `kris.superjam.fun` — a
  name-tag styled input with live availability, and a preview showing how jams
  will hang under it (`tipjar.kris.superjam.fun`, `trivia.kris.superjam.fun`…).
  This is where the user's ENS identity is minted (not at first build). States:
  typing · available ✓ · taken · claiming · claimed.

### 3b. Discover — the feed (default tab)
- **TikTok-style vertical feed**, NOT a grid. One jam fills the screen, the
  next one peeks in from below; swipe up for the next jam.
- **3b-i Feed card (decluttered):** big play surface / jam preview, name,
  **name-tag sticker** (`tipjar.kris.superjam.fun`), maker `by @kris ✓`, and a
  right-side action rail (❤️ like + count, 🏆 scores, 💬 comments → jam page,
  🔁 remix, ↗ share). A **🔁 remix-of `<parent>`** chip sits next to the name
  tag when the jam is a remix. The raw ENS chip does NOT live on the feed card
  — it lives on the jam page. Chain facts are inline + tappable → Basescan (the
  name tag and remix chip carry a small ↗). There is **no DB/ENS source toggle**
  and no card-flip "chain mode" (removed in design round 6).
- **3b-ii Play in the feed:** tap Play and the jam runs **live, right in the
  feed** — it's a real app, not a video (this is the differentiator vs TikTok).
- **3b-iii Jam page** (reached via 💬 or tapping the card): the jam plus
  **Comments · Reviews** tabs, the full name tag (↗ Basescan), remix lineage,
  and a **"🛠 built by `<maker>` · ★4.9"** row (the builder that made it; ⓘ →
  builder profile, §3c-v). Reviews carry the ✓-human story (see §3c reviews
  spec below — same component). States: loading · empty-comments · review-gate.
- **States:** feed loading (skeleton card + next peeking) · live-jam running ·
  jam crashed (friendly "this jam hit a snag" + reload) · empty feed
  ("nothing here yet — make the first jam" + CTA to Make).

### 3c. Make — the flow (idea → jam, machinery hidden)
The make flow is a sequence of beats, NOT a labeled "wizard". No file names,
build logs, terminals, or "agent" talk anywhere.
- **3c-i Make home:** a big "what do you want to make?" idea box up top, with
  example ghosts; **your past-jams shelf** below (a jam baking in the workshop
  does NOT block starting a new one — the shelf shows in-progress + finished).
  Remix entry pre-fills this idea box: header "Based on **<jam>** by @owner",
  read-only recipe summary, box relabeled "Your changes".
- **3c-ii Follow-ups** (appear *after* the user submits the idea — a distinct
  beat, not shown up front): 2–4 tappable option chips **plus** a "your
  comments" stack where the user queues single-line notes as bullets (✕ to
  remove, "+" to add more); one **"Draw up the plan →"** sends chips + notes
  together. (One round, max two; skipped if the idea is already precise.)
  - **Similar-jams interrupt:** if the idea already exists, a card surfaces
    here — ≤3 rows (icon, name, one-line reason) with **Open** / **Remix** /
    dismiss "Make mine anyway". Helpful, one-tap escape, never blocking.
- **3c-iii The plan:** the jam-to-be rendered human-readably as *what's inside
  the toy* (name, what it does, what it remembers, money bits) — never as a
  code spec. Includes an **editable name + ENS address row**
  (`tipjar` → `tipjar.kris.superjam.fun`, auto under the claimed name). A
  ✏️ "change anything" input runs a **visible refine exchange** ("make the
  leaderboard monthly" → "Done ☝️") so the user feels the back-and-forth.
  Primary action → choose builder.
- **3c-iv Choose your builder:** pick who makes it. Default is the house
  builder (free). Community builders are registered ERC-8004 agents — each card
  shows ★ on-chain feedback, jams built, speed, and the **cut they keep**;
  picking a paid one routes USDC to its wallet via the confirm sheet *before*
  dispatch (build fee = attempt fee, no refunds — say so). Each card has an
  **ⓘ → builder profile**.
- **3c-v Builder profile** (opens from any builder card or the "who's making
  this?" chip on the workshop screen): a full info page rendered from the
  builder's **on-chain ERC-8004 record**, de-jargoned — leads with a fetched
  description + the agent's URL, with the registry facts (agent id, operator
  ✓ human, registered-since) and **fetched feedback / score / jams built**
  below. No "ERC-8004" chip shouting at the top; the standard reads as live
  metadata, framed as a workshop staff badge.
- **3c-vi First-jam gate (World ID):** fires **once**, right as the first jam
  heads to the workshop. Big QR legible across a table + *"Verify you're human
  to keep jamming"* + "scan with World App · ~30 seconds, one time" + below-fold
  *"keeps superjam human — no spam jams, no bot hi-scores."* Success returns
  the user to exactly where they were; the ✓ then lives on their profile.
- **3c-vii Making it (the workshop):** the hero make moment. A mini phone
  canvas where **the jam's real UI paints itself in piece by piece** (header +
  coin buttons real, note field + leaderboard still dashed skeleton, a
  "🖌 painting…" badge) — this is the live-preview stretch goal; it degrades
  gracefully to a skeleton + steps if live rendering isn't ready. Alongside:
  workshop steps with a candy progress bar ("Shaping the jar ✓", "Fitting the
  coin slot ✓", "**Hanging the name tag** ⛓ .kris.superjam.fun", "Adding the
  leaderboard…"). Leaving mid-make is fine (it keeps baking, shows on the
  shelf). NO build log, NO file names, NO "agent". Failure = a friendly
  "couldn't finish this jam" + try-again, never a stack trace.
- **3c-viii Reveal:** confetti + the finished jam, its name tag hung
  (`tipjar.kris.superjam.fun ✓`), and a **copyable deep link**
  `superjam.fun/kris/tipjar` that opens straight into the jam in any browser.
  Actions: Play · Share · Send to the crew. (The post-make sheet only picks the
  jam's slug under the already-claimed name — the name itself was claimed at
  signup.)

### 3d. Confirm sheet (the money moment — host-rendered bottom sheet OVER the iframe)
**Stays Toybox** — same warm visual language as the rest, NOT a cold banking
surface. The trust boundary is marked instead by a **"🔒 superjam confirm"**
chip in the sheet header and the explainer line *"asked for by `<jam>` — jams
never touch your wallet."* This is the **only** wallet surface (a jam can never
draw its own money UI — that's the security pitch). Always jam-attributed (jam
icon + name). Four states:
1. **review** — human summary ("Send 0.50 USDC to tipjar.kris.superjam.fun"),
   plain USDC amount large, recipient as name tag when known else short address,
   Approve / Reject.
2. **pending** — spinner → tx hash as a tappable mono chip (↗ Basescan).
3. **success** — check + auto-dismiss → seam back into the jam's own celebration.
4. **error** — readable failure + close.
Reject closes instantly. Single-tx hard cap 25 USDC (amounts above are rejected
before this sheet ever shows). USDC on Base.

### 3e. Inbox — two tabs (Notifications · Friends)
- **3e-i Notifications tab** (default): newest-first — tips received,
  challenges, friend requests, jam mail. Each row carries `@username ✓` +
  "via `<jam>`" attribution + relative time; unread rows distinct; unread
  count badge on the Inbox tab (the retention surface). A row carrying a
  validated invite link gets an **Open** button → jumps into the jam with the
  payload. Mark-all-read. Text is plain text only, never markup.
- **3e-ii Friends tab** (the old "crew" — now reachable here, no longer
  orphaned): add-once-play-everywhere crew list, each `@name ✓` with their ENS
  name; rows open a chat thread. "Add friend".
- **3e-iii Chat thread:** jams, tips, and deep links travel in the thread
  (a shared jam renders as a playable card, a tip as a money line). A **💸
  button opens Pay a friend**.
- **3e-iv Pay a friend (user-to-user):** straight from chat — pick amount, add
  a note, send wallet-to-wallet; lands as a money line in the thread. Same
  ≤25 USDC cap + confirm-sheet trust model.
- **States:** notifications with unread · all-read · empty ("no mail yet — jams
  you play can challenge you") · empty crew · chat empty.

### 3f. Profile (behind the `@kris ▾` chip) + Play & pay theme
- **3f-i Profile:** `@kris` + ENS name (`kris.superjam.fun`), ✓-human badge,
  **Dynamic wallet block** (address short-form + copy, **USDC balance as the
  hero number**, recent activity: tips sent/received, review fees — USDC only,
  no gas/network/token lists), stats, **your jams**, and **your registered
  builders** (each linking to its §3c-v profile). Other users' profiles are
  visitable too (tap any `@name` → their jams + builders).
- **3f-ii Register your builder** (reached from "register one →" on profile):
  name it under yours (`forge.kris.superjam.fun`), point to its endpoint, set a
  USDC price — it gets an **ERC-8004 identity**, an on-chain feedback profile,
  and a revenue share. worldVerified only (human-backed requirement).
- **3f-iii Default jam theme (Play & pay):** the **Toybox** mini-app template
  every generated jam inherits — the look a jam has inside its iframe (§7).
  Shown so designers know generated jams are Toybox too, not dark.
- **Verify block:** World ID status — unverified (Verify CTA) / verified ✓
  (level + date). Quiet, factual.

### 3g. `/app/[slug]/manage` — owner console (utility, low-chrome)
Delist, iterate, **ENS records view** (key→value rows; **Retry** button when a
mint failed — a calm, normal state, since a mint failure never fails a make),
"view source" tab. This is a back-office surface; it can stay plainer than the
playful front-of-house screens, but still Toybox-consistent.

### 3h. Login wall / deeplink entry
Email-first (Dynamic embedded wallet created silently on signup, §3a). A
pending invite deeplink (`superjam.fun/kris/tipjar` or `?d=` payload) MUST
survive the login redirect and land the user inside the jam. Arriving via an
invite needs no special UI — the jam handles the payload.

## 4. Flows (design the seams between screens)

1. **Onboard:** email → wallet appears → **claim your name**
   (`kris.superjam.fun`) → Discover feed.
2. **First make:** Make home idea box → submit → follow-up chips + your-comments
   → "draw up the plan" → the plan (editable ENS row) → choose builder →
   **first-jam World gate (once)** → workshop (UI paints in) → reveal + deep
   link. (Machinery hidden throughout.)
3. **Remix:** feed card / jam page → 🔁 Remix → Make home pre-filled
   ("Based on X… Your changes") → make → NEW jam with remix-of lineage chip.
4. **Invite → play:** inside a jam, "Challenge a friend" → jam sends inbox mail
   with a link → recipient's Inbox badge lights → Open → lands inside the match
   with the challenge loaded.
5. **Tip:** jam button → confirm sheet (review→pending→success) → leaderboard
   updates with ✓-human entries → jam's own celebration.
6. **Pay a friend:** chat thread → 💸 → amount + note → confirm sheet → money
   line in the thread.
7. **Review a jam:** jam page → Reviews tab → (World gate if unverified) → ★ +
   text → row carries ✓; aggregate reads "★4.8 · 31 verified reviews".
8. **Publish/list:** profile → publish → World gate if needed → pay 1 USDC via
   confirm sheet → jam flips to listed, appears in Discover.
9. **Register a builder:** profile → register one → name under yours + endpoint
   + price → ERC-8004 identity + on-chain feedback + revenue share → appears in
   Choose-your-builder.

## 5. Component inventory

JamFeedCard · FeedActionRail · JamPage (Comments · Reviews tabs) · NameTag
(ENS sticker — punched hole + mono; states minted/pending/absent) ·
RemixLineageChip (↗ Basescan) · VerifiedBadge (✓-human sticker) · MakeHome +
PastJamsShelf · FollowUpChips + YourCommentsStack · SimilarJamsCard · PlanCard
(editable ENS row + refine exchange) · BuilderPickerCard + BuilderProfile
(ERC-8004 record, de-jargoned) · WorldGate (big QR) · MakingWorkshop +
LivePreviewCanvas + WorkshopStepList · RevealCard (confetti + deep link) ·
ConfirmSheet (🔒 superjam confirm) · InboxTabs (Notifications · Friends) +
NotificationRow + UnreadBadge · ChatThread + PlayableJamCard + PayFriendSheet ·
ClaimNameScreen · ProfileCard + WalletBlock (USDC hero) + RegisterBuilderForm ·
RatingStars + ReviewRow + ReviewGate · RecordsTable + Retry (manage) ·
StandaloneBanner · Toast (host-rendered) · EmptyState · Skeleton.

## 6. The feature pillars, designer-framed

1. **Discover feed** — a TikTok-style vertical feed where jams **play live**.
   Differentiator vs TikTok: it's a real app, not a video. Social proof (likes,
   scores, remixes, ✓-human maker) and on-chain identity (name tag) ride on
   every card; chain facts are inline + tappable, never a separate "chain mode".
2. **The workshop make** — making a jam reads like a toy workshop, not a
   compiler. The hero is the jam's UI **painting itself in live**; steps are
   hand-made ("Shaping the jar", "Hanging the name tag"). Hide all machinery.
3. **Family-tree identity** — every user is `name.superjam.fun`, every jam hangs
   **under its maker** (`tipjar.kris.superjam.fun`). Provenance is readable from
   the name itself; remix lineage (`remixOf`) doubles it. Treat name tags and
   lineage chips like proud little stickers, everywhere.
4. **The builder economy** — anyone can register their AI as a builder; builders
   are first-class on-chain citizens (ERC-8004 identity, fetched feedback/score,
   USDC revenue share). The Choose-your-builder and Builder-profile screens are
   where this reads.
5. **Inbox as the social loop** — the only push channel (Notifications · Friends
   tabs + chat). The unread badge, "via `<jam>`" attribution, one-tap Open into
   a live challenge, and pay-a-friend are what make jams spread person-to-person.

## 7. Constraints (hard)

- Shell stack: Next.js (App Router), **Tailwind 4**, @base-ui/react
  primitives. Jams style themselves via a fixed **Toybox** theme.css — the
  shell frames them; both share the Toybox visual language so the iframe doesn't
  clash with its frame.
- **Toybox tokens are hard constraints**, not suggestions: paper `#E9E9EE` /
  cream `#FFF4E3` / ink `#221A33`; 2px ink outlines; `0 3px 0 #221A33` sticker
  shadows; Baloo 2 display + ui-monospace for name tags/records; candy primaries
  (`#FF4D6D` `#FFC940` `#2FD180` `#4D7CFF`). No dark-first surfaces.
- The jam iframe fills the viewport under a slim header; the confirm sheet and
  toasts overlay it (the jam never renders its own money UI — host only).
- **Hide the machinery:** no build logs, file names, terminals, code, or AI/
  agent language in any user-facing screen.
- Never render user-generated text as HTML — plain text everywhere (messages,
  jam descriptions, leaderboard names).
- Phone-demo-ready: tap targets ≥44px, state changes legible without reading
  small text, no hover-dependent interactions; high contrast for a projector.
- Speed reads as quality: skeletons over spinners where layout is known; the
  workshop preview paints progressively rather than blocking on a spinner.
