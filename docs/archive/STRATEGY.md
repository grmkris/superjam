> _Archived 2026-06-14 — historical pre-event planning (schedule now past). For
> current state see `SPEC.md` §0.3 + `docs/PIVOT.md`._

# Mini-app host platform — ETHGlobal NYC build

_Date: 2026-06-10. Updated for ETHGlobal NYC (Jun 12–14, Metropolitan
Pavilion, 125 W 18th — starts in 2 days)._

A standalone web platform that hosts third-party **mini apps** in sandboxed
iframes, injects a host **SDK** giving them an embedded EVM wallet + user
profile, and layers an **AI agent** that builds + deploys new mini apps from a
prompt, gated by a **pay-to-review → community listing** marketplace.

Shape = **super-app host** (Telegram/Farcaster/Base mini apps) **+** AI app
builder (v0 / Lovable / bolt) **+** moderated app store, all under one roof I own.

**Design direction: "Toybox"** (decided 2026-06-13, 8 rounds in Claude Design;
full spec in `docs/DESIGN_BRIEF.md` + `docs/DESIGN_SPONSORS.md`). Light/playful/
hand-made — cream paper, ink outlines, sticker shadows, Baloo 2. Mini apps are
called **"jams"**. Three tabs **Make · Discover · Inbox**; Discovery is a
**TikTok-style vertical feed** where jams play live (not a grid). All AI/build
machinery is **hidden from users** — making a jam reads like a toy workshop, not
a compiler. Users claim `name.superjam.fun` at signup and every jam hangs under
them (`tipjar.kris.superjam.fun`). A **builder economy** (anyone registers their
AI as an ERC-8004 builder, with on-chain feedback + USDC revenue share) and
**user-to-user payments** are first-class. (The DB/ENS source toggle was
designed then removed — chain facts are inline, tap a name tag → Basescan.)

---

## ETHGlobal NYC 2026 — hackathon plan

**Event:** Jun 12–14, ~36h build, $225K+ total pool, ~500 hackers. New this
year: **Continuity Track** (allowed to start from an existing repo; sponsor
continuity prizes require demonstrable before/after + commit history).
⚠️ Rules check at kickoff: does reusing old code (e.g. agent orchestration
platform) lock you out of the from-scratch tracks? Decide scratch vs
continuity Friday before writing code.

### Sponsor fit (this idea vs the actual prize list)

| Sponsor | Pool | Fit | Track + qual |
|---|---|---|---|
| **Dynamic** | $10K | **Wallet layer** | "any Dynamic SDK, deployed + usable by judges." Stack: Best Overall ($2K) + Agentic Build ($2K — server wallets / delegated access for the build-agent) + Flow payment abstraction ($4K) |
| **ENS** | $20K | **App identity** | Agent registers `appname.platform.eth` subname per deployed mini app → "Best ENS Integration for AI Agents" ($5K). Functional demo, no hardcoded values, open-source, ENS booth Sun AM |
| **World** | $15K | **Proof-of-human gate** | Only World ID-verified humans publish/review apps — real anti-spam for an AI-generated app store, not cosmetic. Track B backend proof validation ($2.5K) or AgentKit Track A trial/access gating ($7.5K) |
| **Arc (Circle)** | $15K | **Payments chain** | In-app payments + pay-to-review fee in USDC on Arc. "Agentic Economy" / "Chain Abstracted USDC" ($3.25K each). Needs real onchain execution on Arc + architecture diagram + video |
| **Blink** | $5K | **Deposit onramp** | "Working Blink deposit flow" into the embedded wallet. Consumer App Scratch ($3K). Cheap add if SDK is simple |
| **Privy** | $5K | **Stretch: agent's own wallet** | Agent Wallet CLI, ≥1 onchain action — the *build agent* holds a Privy wallet and pays/acts onchain (registers app, pays gas). Stacks alongside Dynamic-for-users |
| Google Cloud | $5K | Weak | Track is BigQuery + ERC-8004 specific → belongs to the AgentTrust idea, not this one. Skip unless ERC-8004 agent-reputation gets bolted on |

**Wallet call: Dynamic over Privy for users.** Double the pool, loosest qual
("any SDK"), and Privy's user-side tracks demand specific features
(Earn / universal deposit addresses). Privy re-enters as the *agent's* wallet
(job hook: Privy Solutions Eng — demo at their booth either way).

**Core stack target: Dynamic + ENS + World, then Arc, then Blink.**
Realistic haul if demo lands: 3–5 sponsor prizes.

**Pitch caution @ World booth:** World App *is* a mini-app host. Frame as
"your model, on the open web, with World ID as the trust layer" —
complementary, not clone.

### 36h schedule

| Block | Build |
|---|---|
| **Fri PM** | Repo + Next.js host shell, Dynamic email-login → embedded wallet, skeleton on Vercel. Rules check (continuity), team formation if any |
| **Sat AM** | `@platform/sdk` (penpal typed RPC), sandboxed iframe, host-side tx confirm UI, hand-written demo mini app, first USDC tx |
| **Sat PM** | Agent pipeline: prompt → template scaffold (SDK pre-wired) → Claude API fills app logic → Vercel API deploy → ENS subname. Then marketplace list + World ID gate + pay-to-review |
| **Sat eve** | Arc go/no-go (port from Base only if smooth — Arc bounty needs real Arc execution). Blink deposit if trivial |
| **Sun AM** | Architecture diagram (Arc requires), demo video, submit, ENS booth, judging |

Pre-decided scope cuts: "review" = fee payment + flag flip (manual/AI-lite
behind it). Agent = ONE template + LLM filling in logic, not general codegen.
Profile = email + World ID badge. **Fallback:** pre-built mini app ready in
case live agent-deploy flakes during judging.

### 3-min demo script

1. Email login → wallet exists under the hood (Dynamic, no seed phrase)
2. Open a community mini app (iframe) → it calls `sdk.wallet.send` → host
   confirm sheet → USDC moves onchain
3. Prompt: *"build me a tip-jar game"* → agent scaffolds, deploys to Vercel,
   registers `tipjar.platform.eth`
4. Verify World ID → pay review fee in USDC → app appears in community list
5. Open the freshly built app, send a tip. **Loop closed: built by AI,
   named on ENS, paid in USDC, used by a verified human.**

---

## Decisions locked (2026-06-10 PM, round 2) — after research sweep

**Full build spec: `mini-app-host-platform-spec.md`** (repo layout, schema, SDK
contract, pipelines, build order). Verified-2026 research highlights:

| Q | Answer |
|---|---|
| Name | **SuperJam** — `superjam.fun` + `superjam.eth` (buy both NOW; `.fun` is DNSSEC-imported into ENS as the parent namespace, `.eth` is the fallback parent) |
| Mini-app hosting | **Own S3 + Caddy** (`apps.superjam.fun`, sandboxed opaque-origin iframe) — not Vercel API. IPFS contenthash + eth.limo = additive stretch (bundles built IPFS-safe from day 1) |
| Storage | **SDK-exposed**: `sdk.storage` (user-private KV) + `sdk.data` (app-scoped shared collections + atomic counters, server-stamped identity). Verified white space: no wallet-bearing mini-app platform gives apps host storage |
| Wallets | **Dynamic everywhere** — embedded (users, email login; confirm-popup toggle OFF → our sheet) + server wallets (build agent). **Privy cut** |
| ENS | **Durin on Base** (repo: namestonehq/durin). Parent = the DNSSEC-imported `superjam.fun` itself (name == URL); agent mints `app.superjam.fun` w/ records in ONE multicall tx; marketplace enumerable from `SubnodeCreated` logs + CCIP-read — "the app store IS ENS." Prior art names agents, not agent *outputs* — that's the angle |
| World | **AgentKit in core scope** ($7.5K track): human-backed builder agent + trial mechanic (1 free jam → World ID to keep jamming/publish). **Primary surface = verified reviews/comments** below jams (one-per-human, un-astroturfable) + creator ✓. World ID v4: backend `rp_context` + `/api/v4/verify` required; deviceLegacy ok for judges |
| Jobs | Inline async + build status table + polling (no BullMQ/Redis) |
| Scratch/continuity | **Scratch** — fresh repo, patterns not code; continuity prizes are fenced separately anyway |

Sponsor corrections vs table below (live 2026 prize pages): Dynamic's $4K
"Flow" = Fireblocks cross-chain payments product (skip); Agentic Build $2K =
verbatim "AI agent uses Dynamic server wallets" (= our agent). World has no
standalone mini-app track — AgentKit $7.5K is the big one; World ID requires
*backend* proof validation. Arc = testnet only (chain 5042002, **gas paid in
USDC**, arch diagram + video required). Blink = blink.cash deposit SDK
(`@swype-org/deposit`) — **merchant approval is manual: apply immediately**.
⚠️ Verify at kickoff: rumored "max 3 sponsor SDKs" rule. ENS workshop Fri
5:30 PM; ENS booth Sun AM in person; submission hard-stop Sun 09:00 EDT.

_Update (spec v2.4, full prize board reviewed):_ **Blink dropped** — deposit
onramp we don't need (demo wallets pre-funded) + manual merchant-approval
dependency. Stretch slot reallocated to **Sui/Walrus** ($3K new-build track —
mini-app bundles on decentralized storage, "hosting a frontend" is their
suggested use; workshop Fri 3:30 PM). ENS AI-agents track links **ENSIP-25 +
ENSIP-26** — spec now implements both verbatim on `builder.superjam.fun`
(ERC-8004 registration + agent-context/agent-endpoint records). Unknown
sponsor "Unlink" ($5K) — check at kickoff.

## Decisions locked (2026-06-10)

| Q | Answer |
|---|---|
| Standalone vs ecosystem | **Standalone** web app, email login, wallet under the hood |
| Wallet / chain | **EVM, embedded wallet** (no extension, no seed phrase) |
| First slice to build | **Host shell + SDK + wallet bridge** |
| Context (2026-06-10) | **This is the ETHGlobal NYC project** — scope to 36h, bounty-stack |
| Wallet provider | **Dynamic** for users ($10K pool, loosest qual); Privy as agent wallet stretch |
| Chain | **Base first, port to Arc** Sat eve if smooth (Arc bounty needs Arc execution) |

---

## Host vs guest — the key mental model

Telegram / Farcaster / Base are **not building blocks** — they are already
platforms of the exact kind I want to build. So the only real fork is which
role I play:

- **Host** = I am Telegram. `myapp.com` is the shell. I inject the SDK, run the
  wallet, own the user. Mini apps live in *my* iframe.
- **Guest** = my app runs *inside* Telegram/Farcaster. They inject *their* SDK +
  wallet, I conform to their identity, rules, chain.

Everything I want — standalone, email login, embedded EVM wallet, **my own**
SDK, **my own** marketplace — **is the host role.** Can't reach it by building
on Telegram/Farcaster; inside those I'm permanently a guest (handed
`@farcaster/miniapp-sdk` + a Farcaster identity; email + own-SDK + own-store
isn't on the menu).

→ Being a host is **built, not plugged into.** "Just with code" is the answer.

**Not either/or forever:** build standalone host first; later the SDK can detect
its environment and *also* publish my mini apps (or the whole shell) *into*
Farcaster/Telegram as a **distribution channel**, routing wallet calls to
whichever host it runs in. Standalone-first keeps that door open; guest-first
closes the host door permanently.

### Tradeoff
- **Standalone (chosen):** full control of SDK/UX/wallet/monetization, no
  platform risk — but bootstrap users from zero, own the security burden (near money).
- **Guest:** instant distribution + wallet/identity solved — but their SDK,
  their rules, no real "my own marketplace."

---

## Don't build the scary parts

| Capability | Don't build | Use |
|---|---|---|
| Email/social login → **embedded EVM wallet** | key mgmt, MPC, seed phrases | **Privy** (one SDK = both), or Turnkey / Coinbase Embedded Wallets / Dynamic |
| iframe ↔ host messaging | raw `postMessage` glue | **penpal** or Comlink, wrapped in a typed SDK |
| Gas (users hold no ETH) | — | AA / paymaster (Privy + Base) |

Privy collapses *email login* **and** *embedded wallet* into one dep — canonical
for "web app, email users, wallet invisible." Better Auth can still own
session/profile with Privy owning the wallet, or let Privy own both. (Open Q.)

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  HOST SHELL (Next.js — the platform)          │
│  ┌─────────────┐  ┌──────────────────────┐    │
│  │ Wallet svc  │  │ Profile / Auth        │    │
│  │ (Privy/AA)  │  │ (email login)         │    │
│  └──────┬──────┘  └──────────┬───────────┘    │
│         │  typed postMessage RPC bridge │      │
│  ┌──────┴──────────────────────────────────┐  │
│  │  <iframe sandbox>  MINI APP              │  │
│  │     imports @platform/sdk                │  │
│  │     sdk.wallet.send() / sdk.profile.get()│  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘

AGENT PIPELINE:  prompt → scaffold (SDK pre-wired) → Vercel deploy
                 → pay-to-review → listed in community registry
```

Reuses pipeline-stage "agent orchestration platform" (virtual FS, S3+Postgres,
Bun/Hono/oRPC, Vercel AI SDK) for the build/deploy half.

---

## Non-negotiable design calls

- **iframes, not micro-frontends (Module Federation).** Module Federation shares
  one JS context → a malicious mini app reads wallet keys/session directly.
  `sandbox` iframe + `postMessage` is the only safe boundary for untrusted code
  near money. Every host (Telegram, Farcaster) does this for this reason.
- **Mini app never signs directly.** SDK sends a *request*; the confirmation UI
  always lives in the **host shell**. Capability permissions (app declares
  "needs payments" at install) + origin allowlisting.
- **SDK = thin typed RPC** over postMessage → devs get `await sdk.wallet.send()`.

---

## First slice — Host + SDK + wallet bridge

Prove the core loop end to end, nothing else:

1. Host shell renders a sandboxed iframe mini app.
2. Host injects `@platform/sdk` (penpal-wrapped RPC).
3. Email login → Privy embedded EVM wallet on the host.
4. Mini app calls `sdk.wallet.send(...)` → host shows confirm UI → tx fires.
5. `sdk.profile.get()` returns the host-owned profile.

Demo target: a trivial mini app (e.g. "tip 0.001 ETH") that triggers a real
host-confirmed on-chain tx. That validates the SDK + wallet + sandbox boundary —
everything else (agent, marketplace) sits on top.

---

## Open questions

- **rsdk** — what was meant? React SDK? a specific lib? (clarify)
- Continuity vs scratch ruling — verify at Fri kickoff before reusing agent
  orchestration platform code.
- This vs **AgentTrust** play (ENS + ERC-8004 + BigQuery, in
  `travel/nyc-ethconf-2026.md`) — both stack ENS; pick ONE Friday. This one is
  more demo-able; AgentTrust owns the Google Cloud $5K.
- Team: solo or recruit Fri? Agent pipeline + host shell is a lot for 36h solo.
- Post-hackathon: revenue (take on payments / pay-to-review / listing fees),
  review = human/AI/hybrid.
- Garbled note to revisit: _"Agent Health… use code to play, then work on the
  game"_ — original intent unclear.
