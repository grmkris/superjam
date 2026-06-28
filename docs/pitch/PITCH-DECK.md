# SuperJam — Pitch Deck (design handoff)

> **For the designer:** build these slides in the **Toybox** brand (see
> ARCHITECTURE.md → *Visual direction*: cream, bold ink outlines, bright sticker
> accents, rounded toy corners, emoji tokens, playful tilt). The deck is **lean on
> purpose — the live demo is the pitch**; slides are scaffolding, not a wall of text.
> Big type, one idea per slide. Target ~5 minutes total (≈3 min of it is the live demo).

**Event:** ETHGlobal New York 2026. This is a **presentation of the project** —
frame everything around what SuperJam does and why it's real. The live demo is the
pitch; slides are scaffolding.

---

## Slide 1 — Title
- **Headline (huge):** SuperJam
- **Sub:** *Describe a toy. An agent builds it. You own it. Humans play.*
- Big playful logo / mascot (⚡ sticker). Team names small at the bottom.
- Visual: cream, a few "jam" stickers/emoji floating with tilt.

## Slide 2 — The insight (problem)
- **Headline:** Making and monetizing a small app is still too much work.
- **Body (3 short stacked lines / icons):** you need to *code it, deploy it, add
  login + a wallet, handle payments, and keep bots out.*
- **Punch line (big):** *What if you just… described it?*
- Visual: a tangled "before" (wires/tools) vs a single clean arrow.

## Slide 3 — What it is
- **Headline:** A marketplace of AI-built "jams."
- **The loop, one line each (with emoji):**
  - 🗣️ Describe it → 🤖 an agent builds + ships a real app — a toy, a tool, or an on-chain game
  - 🏷️ It gets a name on ENS · 💸 it's paid in USDC · 🌍 only humans play
- Visual: 2–3 real jam cards as stickers (e.g. *Tip Jar*, *Spending Explainer*,
  *Trivia*), each wearing a `name.superjam.eth` name tag.

## Slide 4 — ▶ LIVE DEMO  (the centerpiece, ~3 min)
- Full-bleed slide: just **"▶ Live Demo"** + a tiny run-of-show watermark so the
  presenter has cues. (Script in DEMO-SCRIPT.md.)
- Have a **30-sec backup video** embedded in case live deploy flakes.

## Slide 5 — How it works
- **Headline:** Every piece is load-bearing.
- The **architecture diagram** (from ARCHITECTURE.md) fills the slide.
- One caption line: *"Not five integrations — one loop where each is on the critical
  path."*

## Slide 6 — How the pieces fit, one line each (optional combine with slide 5)
Six short capability rows (lead with what it does; the tech is named small):
- **🔑 Wallet** — email in, a wallet exists. No seed phrase, no gas. *(Dynamic)*
- **🏷️ Names** — every jam gets a human-readable on-chain name; provenance is
  readable from the name itself. *(ENS)*
- **🌍 Humans only** — building and reviewing need proof of personhood, so the
  marketplace can't be bot-flooded. *(World ID)*
- **🟢 Money** — tips and payments are gasless USDC, **private by default**. *(Arc · Circle · Unlink)*
- **🎮 On-chain games** — a jam can be a real on-chain game; the agent deploys a
  contract per jam, writes relayed so players never hold ETH. *(Arc)*
- **🤖 Accountable agents** — the builder isn't anonymous: it carries an on-chain
  identity + reputation, human-backed. *(ERC-8004 · AgentKit)*

## Slide 7 — Vision / close
- **Headline (huge):** Built by an AI agent. Named on ENS. Paid in USDC. Ranked by
  verified humans.
- **Sub:** *The App Store for the agent era.*
- CTA: `superjam.fun` + the team handle. End on the mascot.

---

## Appendix slides (only if asked / for judging Q&A)
- **A1 — Architecture deep-dive:** the sandboxed-iframe + SDK identity seam (ES256
  JWT verified against JWKS), so a jam is a real external app that never touches the
  user's wallet.
- **A2 — Proof it's real (small "receipt" stickers, not a wall):** a gasless USDC
  relay on Arc (MPC-signed server wallet); a real agent-built+deployed jam
  (*Spending Explainer*); an ENS name resolving in standard tooling; an **on-chain
  game-contract tx on Arc**; a **live private payment** (x402, off the public
  ledger); the **agent's on-chain identity** (ERC-8004 + AgentKit, human-backed).

## Notes for the designer
- Keep word counts brutal — headline + ≤1 supporting line per slide.
- Reuse the in-product sticker components' look (StickerButton/StickerCard/EmojiToken,
  NameTag) so the deck and the live demo feel like one thing.
- One accent color per slide max; cream stays the constant background.
