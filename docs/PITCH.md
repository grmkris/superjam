# SuperJam — Sponsor Booth Kit (pitch scripts + reaction reads)

_Use at the venue. The live PoC works on your phone:_
https://gateway-production-9c25.up.railway.app — **show, don't tell**: start
making a jam in front of them and talk over the **workshop** as its UI paints
itself in (~40s). (On screen it's a toy workshop, not a build log — narrate
"an AI is building this live"; the user never sees the machinery, the judge
hears the story.)

## The 10-second universal opener

> "I'm building **SuperJam — Telegram Mini Apps for the open web, built by
> AI**. You describe a **jam** — a mini app or game — and it's built and
> deployed in under a minute, running sandboxed with wallet, identity,
> payments, and social baked in through an SDK. You discover jams in a
> TikTok-style feed and **play them right there**. Want to see one get made
> right now?"

## ENS (track #1 — visit Friday AND Sunday AM booth)

**30s:** "Every user claims their name — `kris.superjam.fun` — at signup, and
every **jam** they make hangs **under it**: `tipjar.kris.superjam.fun`, minted
as an ENS subname with url, icon, category, and **remix parent** as text records
on Base via Durin. Provenance is readable from the name itself. The whole
catalog is rebuildable **from ENS records alone** — delete my database, the jam
store survives (chain facts are inline — tap any name tag → Basescan, no toggle
needed). And the builder itself is a first-class ENS citizen:
`builder.superjam.fun` implements **ENSIP-25 + ENSIP-26** — ERC-8004
registration verified through a resolver lookup, agent-context + endpoint
records for discovery — and **anyone can register their own builder** the same
way, with on-chain feedback and a revenue share."

**Q→A:** L1 or L2? → *Durin L2 registry on Base, L1Resolver wired; mint = one
tx with a setText multicall.* · Indexing? → *getLogs(SubnodeCreated) + direct
L2 reads for the demo; **ENSNode is the production path**.* · ENSIP-25 real? →
*one tx into the ERC-8004 mainnet registry, then the `agent-registration`
record (ERC-7930 registry address in the key); verification = a single
resolver lookup, shown live in the agent identity panel.*

**Read for:** AI-agents track vs Most Creative (catalog-as-ENS + remix
provenance tree). Ask them which of their tracks fits better — free judging
intel. Confirm the $6K Integrate pool stacks.

## World

**30s:** "SuperJam is an AI app factory — which means it's a **spam factory
without proof of personhood**. World ID is load-bearing: one free build, then
building, publishing, remixing — and **reviewing** — require verification, one
nullifier per human. The catalog can't be bot-flooded, every leaderboard entry
is a verified human, and **every jam review is one-per-human — app-store
reviews are the most astroturfed surface on the internet; ours are
cryptographically one-per-person**. Backend v4 proof validation, not just the
widget. The builder agent itself is **AgentKit-registered, human-backed by
me**."

**The move:** hand them your phone at the trial gate; let them verify with
their own World App — exactly what judges do Sunday.

**Q→A:** Device or Orb? → *device accepted (judges verify in minutes), Orb
honored.* · What breaks without it? → *"spam apps, bot leaderboards, sybil
remix farms, inbox spam, astroturfed reviews. A constraint, not a checkbox."*
· AgentKit usage? → *agent registered via CLI, bound to my World App; identity
panel shows human-backed next to its ENS records; x402 on the agent endpoint
if time.*

**Read for:** AgentKit ($7.5K) vs World ID. If they lean in at "human-backed
builder agent", AgentKit it is; World ID is the zero-cost fallback.

## Dynamic (SDK used regardless; prize = slot-3 option)

**30s:** "Email in → embedded wallet exists, invisibly. No seed phrase, no
gas, no network picker — users see 'Send 0.50 USDC' in a confirm sheet the
*host* renders, signed by the Dynamic wallet underneath, **EIP-7702 gas
sponsorship under the hood: a judge's wallet never holds ETH, start to
finish** (SPEC §15.1) — and tips don't even need that: they're relayed by
Unlink. Crypto UX that never says crypto, usable by judges on their phones."

**Slot-3 probe:** "the builder agent can run on a Dynamic server wallet for
its on-chain actions — ENS mints, ERC-8004 registration." Gauge how smooth
server-wallets feel from their demo; ~2-3h add if chosen.

**Booth asks:** can they un-gate native `sendSponsoredTransaction`
(enterprise-flagged) for our environment? — drops our ZeroDev dependency.
And: is the embedded wallet's `personal_sign` deterministic across TSS-MPC
signs? (gates Unlink `fromEthereumSignature` key derivation for the
nanopayments lane).

## Slot-3 scouting (Friday; decide Fri eve)

**Walrus (Sui booth, workshop Fri 3:30 PM):** "Every AI-built bundle also
publishes to Walrus, blob id in the app's ENS records — the app store survives
my database AND my servers dying." Ask: publisher endpoint friction; judged on
depth or story? One-HTTP-call publishing → strongest slot-3 candidate.

**Unlink/Arc (nanopayments combo, SPEC §3 — now PRESUMPTIVE slot-3):** "On
SuperJam **every tip is confidential by default** — Unlink shielded transfer
on Arc, relayed so the sender pays no gas, the Dynamic wallet as the key root.
The only payments we keep public are the ones we must verify on-chain (publish
fee, pot escrow). Two rails, one rule. And jams can make private *nanopayments*
too: `sdk.payments.payX402` pays a paywalled resource via Circle Gateway from a
shielded Arc balance — all four (Dynamic+Unlink+Circle+Arc) in one call (gated;
tips alone already cover 3)." Asks: recipient note-discovery latency
(how fast does a judge SEE the tip?) · deterministic `personal_sign` for key
derivation (also ask Dynamic) · does Arc-as-chain satisfy the "all three
technologies" rule or is the Circle Gateway/x402 leg required? SDK is
`@canary` — gauge stability from their own demo.

**Ledger (only with a device in hand):** "My agent is autonomous until it
touches real value — then a human confirms on a Ledger. Verified humans
publish → human-backed agent builds → device-secured operator approves
privileged actions. The trust hierarchy ends in hardware." Five winners =
best odds on the board.

## Booth tactics

Get the booth person's **name** (they brief judges) · ask *"what would make
this a winner for your track?"* and write it down · confirm the rumored
3-sponsor-submission cap with **ETHGlobal staff**, not sponsors · end every
conversation with the live build running on your phone.
