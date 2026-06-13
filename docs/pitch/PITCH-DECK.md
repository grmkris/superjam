# SuperJam — Pitch Deck (design handoff)

> **For the designer:** build these slides in the **Toybox** brand (see
> ARCHITECTURE.md → *Visual direction*: cream, bold ink outlines, bright sticker
> accents, rounded toy corners, emoji tokens, playful tilt). The deck is **lean on
> purpose — the live demo is the pitch**; slides are scaffolding, not a wall of text.
> Big type, one idea per slide. Target ~5 minutes total (≈3 min of it is the live demo).

**Event:** ETHGlobal New York 2026. **Prize targets (weight the narrative across all,
ENS is the single largest):** ENS $20K · World $15K · Arc/Circle $15K · Dynamic $10K ·
Unlink $5K.

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
  - 🗣️ Describe it → 🤖 an agent builds + ships a real app
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

## Slide 6 — Why each sponsor, in one line (optional combine with slide 5)
Five short rows, each with the sponsor logo + the *why*:
- **🔑 Dynamic** — no seed phrase; *and the builder is an autonomous agent with its
  own server wallet that signs + mints.*
- **🏷️ ENS** — a human-readable name for every jam *and every agent*: provenance for
  AI-built apps.
- **🌍 World ID** — an open AI-app marketplace needs a bot wall: reviews + publishing
  are one-human-one-account.
- **🟢 Arc / Circle** — micro-tips only work gasless: USDC via EIP-3009, no ETH.
- **🕶️ Unlink** — …and private: nanopayments off the public ledger.

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
- **A2 — Proof it's real:** live txs (gasless USDC relay on Arc, MPC-signed by the
  Dynamic server wallet), a real agent-built+deployed jam (*Spending Explainer*), an
  ENS name resolving in standard tooling.

## Notes for the designer
- Keep word counts brutal — headline + ≤1 supporting line per slide.
- Reuse the in-product sticker components' look (StickerButton/StickerCard/EmojiToken,
  NameTag) so the deck and the live demo feel like one thing.
- One accent color per slide max; cream stays the constant background.
