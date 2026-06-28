# SuperJam — hackathon submission

## Short description *
_A max 100-character or less description of your project (it should fit in a tweet!)_

Make and play little apps with money baked in. Say it in a sentence, an AI ships it in a minute.

---

## Description *
_Go in as much detail as you can about what this project is. Please be as clear as possible! (min 280 characters)_

SuperJam is a super-app host for the open web — a place to **make and play little apps, with money, that anyone can use.** We call them **jams.**

You describe a jam in a single sentence — "a tip jar with a leaderboard," "a daily trivia game," "a doodle-guessing duel" — and an AI builder agent designs, builds, and deploys it live in under a minute. No code, no terminals, no build logs: you just watch your jam come together, and then it's online.

You discover jams in a **TikTok-style vertical feed**, but with a twist — tap Play and the jam runs **live, right there in the feed.** It's a real, working app, not a video.

Everything crypto is invisible. You sign in with email and a wallet appears with it — no seed phrase, no extension. You claim your name and it's **yours on-chain forever** (`you.superjam.eth`), and every jam you make hangs under it (`tipjar.you.superjam.eth`). Jams can hold real money, run **real on-chain games**, and pay out — but to a player it just feels like a toy that happens to have a coin slot.

Under the hood, an agent economy does the work: real AI builder agents — each with its own wallet, an on-chain ERC-8004 identity, and a USDC reputation stake on the line — build your jam, some backed by a verified human via World ID. Payments settle on Circle's Arc chain, can be made fully private via Unlink, and your own coding agent can even commission a jam for you over MCP.

---

## How it's made *
_Tell us about how you built this project; the nitty-gritty details. What technologies did you use? How are they pieced together? If you used any partner technologies, how did it benefit your project? Did you do anything particularly hacky that's notable and worth mentioning? (min 280 characters)_

**Architecture.** A Bun + Turborepo monorepo. The consumer app (`apps/web`) is Next.js on Vercel; an API server runs on Railway; smart contracts live in a Foundry package (`packages/contracts`); and an AI **builder agent** turns prompts into deployed apps. Shared code — the injected SDK, on-chain helpers, the DB layer, and per-environment service URLs — lives in `packages/*` (`sdk`, `onchain`, `db`, `shared`).

**Jams are sandboxed mini-apps.** Each jam runs in a sandboxed iframe with an SDK injected over `postMessage`, giving it a uniform surface: wallet, profile, key-value storage, and shared cross-jam data. The host owns every sensitive action — a jam can *request* a payment, but the wallet and confirmation live in the host, so "jams never touch your wallet." Generated jams ship with our "Toybox" theme so they look host-native out of the box.

**The make pipeline.** A prompt becomes a plan, the user tweaks it conversationally, then a builder agent generates the code and deploys it — Next-on-Vercel for full apps, standalone Vite bundles for games. Publishing is gated by World ID (humanness) and a small pay-to-publish fee in USDC.

**Two chains.** Circle's **Arc** is the money chain (settlement + USDC); **Sepolia L1** carries identity (ERC-8004 + ENS v2) and is the CCTP source. One `APP_ENV` drives per-environment URLs.

**Partner tech, and what each bought us:**
- **Dynamic** — email-login embedded EVM wallets (the "wallet appears with you, no seed phrase" magic), plus TSS-MPC server wallets that let builder agents sign autonomously, and delegation that powers agent-hires-agent over MCP.
- **World ID** — idkit v4 with a managed RP (the RP self-signs `rp_context`); used both as the anti-Sybil gate to keep publishing and to mark builder agents as human-backed.
- **Circle** — Arc for settlement, **CCTP** for cross-chain USDC (e.g. funding a stake from Sepolia), and gasless **EIP-3009** transfers relayed by the server for tips and in-game payments.
- **Unlink** — a shielded private-payment rail so an agent can pay for work without leaking its balance or transaction graph.
- **ERC-8004 + ENS v2** — every builder agent (and every user) gets a real, human-readable on-chain identity; a self-contained `SuperjamRegistry` resolves those names in standard ENS tooling.
- **x402** — the pay-to-publish build fee is charged over the private rail; free when the user is World-verified and the builder is AgentBook-registered.
- **MCP** — a SuperJam MCP server lets a coding agent (e.g. Claude Code) hire a builder *as you* via a scoped `sjat_` PAT + Dynamic delegation, turning "build me an app" into one delegated transaction.

**Notably hacky bits:**
- The Unlink rail couldn't bootstrap from Dynamic delegation (WaaS key-shares threw `No wallet provider found`), so we bootstrap the shielded account from a **one-time browser signature** of a canonical message and replay it server-side — one seam then covers payments, build fees, and tips.
- **Nested ENS names** (`<slug>.<user>.superjam.eth`) work via an ENSIP-10 **wildcard resolver**: our registry is its own `IExtendedResolver` (it has no `setSubregistry`), yet still resolves through canonical ENS tooling.
- On-chain game writes are **operator-relayed and gasless** — the Arc operator must equal the API server wallet or the writes revert.
- The web app is forced to build with **webpack, not Turbopack**, because the Dynamic React SDK needs it.

---

## Describe how AI tools were used in your project *
_Be specific about which tools were used and explain which parts of the projects they were used for._

**SuperJam was built almost entirely inside Claude Code** (Anthropic's agentic CLI, running Claude Opus 4.x) — and not as a single assistant in an editor. We ran **multiple Claude Code agents in parallel on one shared `dev` branch**, each owning a lane and coordinating through a shared, file-based project memory:

- **Web app** — the Next.js consumer surfaces (make / discover / jam feed / confirm sheet / inbox / profile) and the sandboxed-iframe SDK bridge.
- **Builder agent** — the pipeline that turns a one-sentence prompt into generated, deployed code (Next-on-Vercel apps and standalone Vite games).
- **Smart contracts** — the Foundry package (`StakeSlash` stake/slash + yield vault) and its test suite, written and iterated with Claude.
- **On-chain integration** — the Arc / CCTP / EIP-3009 rails, the Unlink shielded-payment seam, and the ERC-8004 + ENS v2 (`SuperjamRegistry`) identity layer.
- **Infra & deploy** — Railway + Vercel wiring, per-environment env, and the SuperJam MCP server.

Beyond writing code, Claude was used to **debug live deployments** (reading Railway/Vercel build logs and fixing red deploys), **reverse-engineer partner SDKs**, and work through the genuinely hard integration bugs — the Dynamic WaaS key-share failure that forced the one-time browser-signature bootstrap for Unlink, and the ENSIP-10 **wildcard resolver** that makes nested `<slug>.<user>.superjam.eth` names resolve in standard ENS tooling. Commits are co-authored by the model accordingly.

**AI is also the product, not just the toolchain.** The make flow's prompt → plan → refine step is LLM-driven (with image attachments fed through vision so a sketch or mockup shapes the spec), and the builder agents that design, build, and deploy each jam are themselves AI agents with on-chain identities and a USDC stake on the line. That product-side use is detailed under **How it's made**; AI even reaches the user's own machine via our **MCP server**, which lets a coding agent (e.g. Claude Code) commission a jam *as you*.

---

## Prize submissions

GitHub base for all links: `https://github.com/grmkris/superjam/blob/dev/`

### World — $15,000

**How are you using this Protocol / API?**
We use **World ID (IDKit v4, managed RP)** as SuperJam's proof-of-humanity layer. Two roles: (1) an **anti-Sybil gate** — verifying you're a unique human is required to *publish* a jam, leave a review, register a builder agent, or top up, enforcing one-human-one-account via the RP-scoped nullifier; and (2) it marks **builder agents as human-backed**, so every AI agent in our marketplace can be traced to a verified person. We run a **managed RP that self-signs `rp_context`** server-side and do full **backend proof verification** against World's `/api/v4/verify/{rp_id}` endpoint (the hard-track requirement), binding the returned nullifier to the account.

**Link to the line of code where the tech is used:**
- https://github.com/grmkris/superjam/blob/dev/packages/api/src/routers/world.ts#L66-L99 -> backend proof verification + nullifier Sybil-binding
- https://github.com/grmkris/superjam/blob/dev/packages/api/src/auth/world.ts#L157 -> managed-RP verifier (forwards the v4 result to /api/v4/verify/{rp_id} & self-signs rp_context)
- https://github.com/grmkris/superjam/blob/dev/packages/api/src/orpc.ts#L76 -> anti-Sybil gate procedure (worldVerifiedProcedure)
- https://github.com/grmkris/superjam/blob/dev/apps/web/src/components/world-gate-widget.tsx#L60 -> frontend headless IDKit v4 widget (useIDKitRequest, WASM, SSR-safe)

**How easy is it to use the API / Protocol? (1–10):** 6

**Additional feedback for the Sponsor:**
IDKit **v4 is powerful but under-documented** — most examples still target v3's modal/cloud-proof flow. Friction points: (1) the **headless `useIDKitRequest` path** and the exact shape of the v4 `result` (`responses[]`, where the nullifier actually lives vs. the verify reply) took reverse-engineering; (2) **`idkit-core` runs on WASM**, which blew up under Next.js SSR/prerender until we isolated it behind `next/dynamic({ ssr:false })` — worth a prominent note in the docs; (3) the **managed-RP `rp_context` self-signing** contract (signing-key rotation to obtain the key, nonce-per-request, `expires_at`) wasn't obvious. A first-class **Next.js App Router + headless v4 + backend-verify** example would have saved us hours. Once wired, it was rock-solid.

---

### Arc (Circle) — $15,000

**Why you're applicable for this prize:**
**Arc is SuperJam's single money chain.** All value moves there: the pay-to-publish build fee, tips, and in-game payouts settle in USDC on Arc, taking advantage of Arc's **USDC-native gas** (no paymaster). Users sign gasless **EIP-3009 `transferWithAuthorization`** transfers that the server relays on Arc, and we use Circle's **CCTP** to bridge USDC from Ethereum Sepolia into native USDC on Arc (funding builder stakes and shielded balances), including a `depositForBurnWithHook` path that credits an on-chain escrow hook on arrival.

**Link to the line of code where the tech is used:**
- https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/chains.ts#L17 -> Arc Testnet chain definition (id 5042002, USDC-native gas) + PUBLIC_CHAIN = arcTestnet
- https://github.com/grmkris/superjam/blob/dev/packages/api/src/routers/payments.ts#L135 -> gasless EIP-3009 settlement relay on Arc
- https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/transfer-auth.ts -> EIP-3009 typed-data (signed client-side, reconstructed server-side)
- https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/cctp.ts -> CCTP Sepolia → Arc bridge (depositForBurn / depositForBurnWithHook + Iris attestation)

**How easy is it to use the API / Protocol? (1–10):** 8

**Additional feedback for the Sponsor:**
**USDC-as-native-gas on Arc is a genuine UX unlock** — it removed an entire paymaster layer and made gasless payments trivial. EIP-3009 + standard viem clients "just worked" against `rpc.testnet.arc.network`. The main friction was **CCTP v2**: the Iris attestation flow (poll `/v2/messages/{sourceDomain}?transactionHash=…`, domain ids, fast-vs-standard fee, the hook-data encoding for `depositForBurnWithHook`) required stitching together several docs and some on-chain trial. A single end-to-end **"burn on L1 → attest → mint on Arc with a hook"** reference (with the exact domain ids and fee semantics) would smooth this a lot. Testnet was stable throughout.

---

### Dynamic — $10,000

**Why you're applicable for this prize:**
**Dynamic is how a wallet "appears with you."** Users sign in with email and get an **embedded EVM wallet** (no seed phrase, no extension) via the headless `@dynamic-labs-sdk/*` client; that wallet signs every payment through Dynamic's viem-interop wallet client. On the backend, the privileged signer is a **Dynamic TSS-MPC server wallet** that lets our builder agents sign autonomously, and Dynamic-issued **JWTs** authenticate every API call. We also use **Dynamic delegation** to power *agent-hires-agent*: a scoped `sjat_` PAT lets a user's coding agent (over our MCP server) build and pay **as the user** through their Dynamic-delegated wallet.

**Link to the line of code where the tech is used:**
- https://github.com/grmkris/superjam/blob/dev/apps/web/src/lib/dynamic-client.ts#L14 -> embedded wallet, headless Dynamic client (email login, EVM extension)
- https://github.com/grmkris/superjam/blob/dev/apps/web/src/components/confirm/pay-executor.ts#L18 -> signing payments via Dynamic's viem-interop wallet client
- https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/viem-server-wallet.ts#L65 -> TSS-MPC server wallet, the privileged signer (createServerWalletFromKey at L138)
- https://github.com/grmkris/superjam/blob/dev/packages/api/src/index.ts#L8 -> Dynamic JWT verifier for API auth (createDynamicVerifier)
- https://github.com/grmkris/superjam/blob/dev/packages/api/src/routers/auth.ts#L34 -> delegation: PAT lets an external agent act AS the user via the Dynamic-delegated wallet

**How easy is it to use the API / Protocol? (1–10):** 5

**Additional feedback for the Sponsor:**
Email-login embedded wallets are excellent and the headless SDK is the right direction. But the migration cost us real time: the **React-context SDK (`@dynamic-labs/sdk-react-core`) crashed** in our Next.js App Router setup ("No Dynamic client" across nested providers), forcing a switch to the new imperative **`@dynamic-labs-sdk/*`** client — and the working recipe we needed (`autoInitialize:true` + `addEvmExtension`, *not* `addWaasEvmExtension`) was hard to find. The React SDK also **only builds under webpack, not Turbopack**. The biggest blocker was **delegation/WaaS**: `delegateWaasKeyShares` threw `No wallet provider found`, so we couldn't bootstrap our private-payment rail from delegation and fell back to a one-time browser-signature seam (see below). Clearer headless-SDK + App-Router + delegation docs would raise this to a 9.

---

### Shared / Nanopayments bounty — Arc × Unlink × Dynamic (combined)

These three compose into one flow: an **agent pays for work, privately, in USDC.**
- **Dynamic** provides the signer — an embedded/MPC wallet whose owner is a real, authenticated identity.
- **Unlink** wraps that signer into a **shielded account** so balances and the transaction graph stay private; one cross-lane seam, `getUserSigner(userId)`, gives every user exactly one server-executed Unlink account (no per-tx popup).
- **Arc** is where it all settles — the shielded USDC transfer lands on the money chain, and **CCTP** funds the shielded pool from Sepolia.

The **x402 pay-to-publish build fee** rides this exact stack: charged over the **Unlink private rail on Arc**, signed by the **Dynamic** wallet — and free when the payer is World-verified and the builder is AgentBook-registered. Notably hacky: because Dynamic's `delegateWaasKeyShares` failed, the Unlink account is bootstrapped from a **one-time browser signature** of a canonical message, replayed server-side — one seam then covers payments, build fees, and tips.

- https://github.com/grmkris/superjam/blob/dev/packages/api/src/services/unlink-service.ts#L22 -> Unlink per-user shielded rail + the getUserSigner seam
- https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/agentkit-client.ts#L45 -> Dynamic-delegated agent hire (AgentBook)
- https://github.com/grmkris/superjam/blob/dev/packages/onchain/src/cctp.ts -> CCTP funding the shielded balance on Arc

---

## Assets
- **Logo (512×512):** `apps/web/src/app/icon.png` (also `apple-icon.png` @ 180²)
- **OG / social card (1200×630):** `apps/web/src/app/opengraph-image.png` (and `twitter-image.png`)
- **Cover (16:9, 640×360):** regenerate → `.brand/cover-640x360.png`
- Brand source of truth: `.brand/build-brand.mjs` renders every SVG/PNG from code (using `.brand/fonts/`). Generated assets are git-ignored — run `node .brand/build-brand.mjs` to (re)produce `.brand/*` and the Next.js icons under `apps/web/src/app/`.
