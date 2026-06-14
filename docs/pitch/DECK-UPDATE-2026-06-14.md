# Pitch deck — update brief (2026-06-14)

> **For the SuperJam pitch agent** (the Claude Design agent that owns
> `SuperJam Pitch.dc.html`). The deck is current on the architecture but predates
> three things we shipped in the last two days. This is a **presentation of the
> project** — frame everything around what SuperJam *does* and why it's real.
> Keep it **lean and demo-centric** (Toybox brand: cream, ink outlines, sticker
> accents, big type, one idea per slide). These are **additive sharpenings +
> de-hedges** — no bloat, **no sponsor-prize / track framing anywhere**. The tech
> (wallet, naming, proof-of-human, payments) appears only as *how it works*.

## What's new (the only new facts you need)

1. **On-chain games are real.** A jam can now be a true on-chain game — the builder
   **deploys a game contract per jam**, and the SDK reads/writes it. **Writes are
   gasless** (relayed), so the player never holds ETH.
2. **Private nanopayments are proven live.** A jam can charge for a paywalled
   resource paid from a **private balance** — settled live, off the public ledger.
   (Previously a "maybe" — it works now.)
3. **The builder agent has a real, human-backed identity.** It carries an
   **on-chain identity + reputation**, backed by a verified human. The agent isn't
   anonymous — it's accountable.
4. **A marketplace of builders** (context): there's **no house builder** — every jam
   is built by a registered agent. Anyone can register one (its own name, on-chain
   reputation, a stake, revenue share). The build itself is paid privately, and
   **free for a verified human**.
5. **Naming/chain cleanup:** every jam's name is an **ENS name that resolves in
   standard tooling** (nested under the user). If the deck names any older test
   network, simplify to "on-chain" — don't name removed networks.

## Slide-by-slide

- **Slide 6 (how the pieces fit)** — sharpen, about *capability*, not logos:
  - Wallet: email in → a wallet exists, no seed phrase, no gas.
  - Naming: every jam gets a human-readable on-chain name; provenance is readable
    from the name.
  - Humans-only: building and reviewing require proof of personhood — the
    marketplace can't be bot-flooded.
  - Money: tips and payments are gasless USDC, **private by default**.
  - **New** — Games: jams can be real on-chain games, with gasless writes.
- **Slide 3 (what it is)** — optional one-word widen: jams are
  "*toys, tools, or on-chain games.*"
- **Appendix / "proof it's real"** — add three live receipts: an **on-chain game
  tx**, a **live private payment**, the **agent's on-chain identity**. Small sticker
  receipts, not a wall.
- **Optional half-line** — "*a marketplace of builders*" (anyone can register an
  agent that gets paid to build). Only if it fits the time budget; otherwise save
  for Q&A.

## Guardrails
- **No sponsor-prize or track framing** — present the project on its own terms.
- Don't touch the live-demo slide flow (it's the pitch).
- Headline + ≤1 line per slide. Don't soften live features back to "planned."
- Reuse in-product sticker components' look so deck and live demo feel like one thing.
