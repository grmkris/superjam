# SuperJam — Architecture (design handoff)

> **For the designer:** produce ONE clean architecture diagram from this spec. It
> doubles as the slide-5 visual in the deck AND the architecture diagram Arc/Circle
> require for their prize. Keep the **Toybox** brand (see *Visual direction*). The
> goal a judge should take away in 5 seconds: **every sponsor is on the critical
> path, not bolted on.**

## The one-liner
**Describe a toy. An AI agent builds and ships it. You own the name, you get paid,
and only real humans play.**

SuperJam is a marketplace of **"jams"** — small apps/toys you create just by
describing them. An AI agent generates and deploys each jam as a real, live web app;
the platform wraps it with identity, payments, naming, and a human-only gate.

## The loop (what the diagram shows)
Draw it as a left-to-right **loop** in three labelled bands. Each band is a "ring":

**Ring 1 — Identity (who)**
- 👤 **You** → email login, *no seed phrase* → 🔑 **Dynamic** embedded wallet.
- 🌍 **World ID** proof-of-human → "one human = one account" (gates publish + reviews).
- 🏷️ **ENS** name = your handle (`you.superjam.eth`) + every jam's name.

**Ring 2 — Creation (what)**
- You type a prompt → 🤖 **AI Builder Agent** (has its *own* Dynamic server wallet,
  and an **ERC-8004 on-chain identity** — agent NFT + reputation — **human-backed via
  World ID / AgentKit**, not anonymous). Builders are a **marketplace** — no house
  builder; anyone can register one.
- Agent **generates a Next.js app + Neon DB** → **deploys to Vercel** → registers its
  `entryUrl`. For an on-chain game, it also **deploys a bespoke game contract on Arc**
  and wires the SDK to read/write it.
- Agent **mints `slug.you.superjam.eth`** natively in **ENSv2 on Sepolia L1** — a real
  subname **nested under the user** (ENSIP-10 wildcard), **resolvable in standard ENS
  tooling** (`app.ens.domains`, viem/ethers), not a closed registry.
- The jam runs in a **sandboxed cross-origin iframe** + a postMessage **SDK bridge**;
  it calls back for identity (`sdk.auth.getToken()` → an ES256 JWT the jam's own
  backend verifies against the platform's JWKS).

**Ring 3 — Value (how it pays)**
- Inside a jam you **tip USDC** → host **confirm sheet** (the only thing that touches
  your wallet) → **EIP-3009 gasless** transfer → **server wallet relays on Arc**
  (gas paid in USDC, no ETH) → **private via Unlink**.
- **On-chain game writes** go through `sdk.onchain` → **operator-relayed, gasless** on
  the jam's Arc contract; the player never holds ETH.
- **Private nanopayments (proven live):** `sdk.payments.payX402` pays a paywalled
  resource from a shielded Arc balance via Circle Gateway — off the public ledger.
- **Add funds:** a **fast CCTP** burn/mint (Circle, Sepolia → Arc) lands USDC in a
  **confidential Unlink balance**; tips then spend from it, off the public ledger.

## Diagram skeleton (reference — redraw in the brand)
```mermaid
flowchart LR
  subgraph ID["① IDENTITY — who"]
    U([👤 You]) -->|email · no seed| DYN[🔑 Dynamic wallet]
    WORLD[🌍 World ID<br/>one human = one account]
    ENS[🏷️ ENS name · ENSv2 / Sepolia L1<br/>resolves in standard tooling]
  end
  subgraph MAKE["② CREATION — what"]
    U -->|"describe a jam"| HOST[SuperJam host]
    HOST --> AGENT[🤖 AI Builder Agent<br/>own server wallet · ERC-8004 identity · human-backed]
    AGENT -->|generate + ship| VERCEL[▲ Vercel + Neon app]
    AGENT -->|deploy game contract| GAME[🎮 Arc game contract]
    AGENT -->|mint slug.you.superjam.eth · ENSv2| ENS
    VERCEL --> JAM[▦ The Jam<br/>sandboxed iframe + SDK bridge]
    JAM -->|getToken → ES256 JWT<br/>jam backend verifies vs JWKS| HOST
  end
  subgraph PAY["③ VALUE — how it pays"]
    FUND[➕ Add funds] -->|fast CCTP · Sepolia→Arc| BAL[🕶️ confidential Unlink balance]
    JAM -->|tip USDC| CONFIRM[💸 host confirm sheet]
    CONFIRM -->|EIP-3009 · gasless on Arc| ARC[🟢 Arc / Circle relay]
    JAM -->|onchain writes · relayed gasless| GAME
    JAM -->|payX402 nanopayment · proven live| BAL
    ARC -->|private| BAL
  end
  WORLD -->|gate publish + reviews| HOST
```

## Caption (put under the diagram)
*"One loop. Invisible wallets + an autonomous, human-backed agent. A name for every
agent-built app, resolvable in any standard ENS tool. A bot wall for an open
marketplace. Gasless USDC so micro-tips actually work; jams can be real on-chain
games with relayed writes — and payments are private by default."*

## Tech stack (small footer, optional)
Next.js 16 · Hono + oRPC · Drizzle + Postgres/Neon · Dynamic (auth + embedded +
server wallet) · World ID 4.0 + **AgentKit** (human-backed agent) · **ENSv2 names on
Sepolia L1** (standard-tooling resolvable) · **ERC-8004** agent identity + reputation ·
USDC EIP-3009 on Arc · **bespoke Arc game contracts** (operator-relayed gasless
writes) · Circle **CCTP + Gateway** (**x402 nanopayments, proven live**) · Unlink
confidential balance. Jams are external apps (Vercel + own DB) framed cross-origin and
unified only by the SDK + identity + payments + naming.

## Visual direction — "Toybox"
The brand is **playful and warm — a name tag on a toy, not cold crypto/bank UI.**
- **Palette:** cream background; bold dark "ink" outlines; bright sticker accents —
  green, yellow, pink, blue.
- **Shapes:** rounded "toy" corners, chunky drop-shadows (sticker shadow), slight
  playful tilts (±5°), emoji "tokens" in rounded squares.
- **Type:** friendly, heavy/extrabold display for headlines; clean sans for body.
- **Tone:** approachable, fun, confident. Avoid dark dashboards, gradients-as-crypto,
  hexagons. Think *App Store meets sticker book.*
- Sponsor logos appear **at the node where the tech does real work** (small, tasteful).

## What "done" looks like
A single landscape diagram, brand-styled, readable on a projector, with the three
rings clearly labelled and the five sponsor logos placed on their real touchpoints,
plus the one-line caption.
