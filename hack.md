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

## Assets
- **Logo (512×512):** `apps/web/src/app/icon.png` (also `.brand/logo-512.png`)
- **Cover (16:9, 640×360):** `.brand/cover-640x360.png`
- **OG / social card (1200×630):** `apps/web/src/app/opengraph-image.png` (also `.brand/og-1200x630.png`)
- Editable SVG source + generator: `.brand/{logo,cover,og}.svg`, `.brand/build-brand.mjs`
