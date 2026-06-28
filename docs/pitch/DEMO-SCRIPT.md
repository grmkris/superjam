# SuperJam — Live Demo Run-of-Show (design + presenter handoff)

> **Purpose:** the timed script for the ~3-minute live demo (the heart of the pitch).
> Two columns: **SAY** (narration) and **DO** (on-screen). Practice it to muscle
> memory. A **30-second screen recording of this exact flow is the mandatory backup**
> (also doubles as the Arc/Circle demo-video requirement). Demo on a clean
> browser/incognito tab to avoid stale state.

**Closing line to land (memorize):**
> *"Built by an AI agent, named on ENS, paid in USDC, used and ranked by verified
> humans."*

---

## Run-of-show

| t | DO (on screen) | SAY (narration) | Sponsor beat |
|---|---|---|---|
| 0:00 | Open `superjam.fun`. Click **Log in**, enter email, code → a wallet appears. | "I'm going to build and ship a real app in three minutes — starting with login. No seed phrase, no extension — just email, and I have a wallet." | 🔑 **Dynamic** |
| 0:25 | Tap **Make**. Type: *"a tip jar that thanks people who tip."* Hit go. | "I describe what I want in plain English…" | the hook |
| 0:40 | Workshop animation plays; the jam paints itself in. Reveal: it opens, framed, playable. | "…and an AI agent writes it, deploys it as a real web app, and hangs its name tag — all on its own." | 🤖 **the wow** |
| 1:20 | Inside the jam, click **Tip**, choose 0.5 USDC. The **confirm sheet** slides up. Approve. | "Now I tip it — half a dollar of USDC. The jam never touches my wallet; this confirm sheet does. And it's gasless — I don't need any ETH." | 🟢 **Arc/Circle** |
| 1:50 | Show the tx confirming (chip → explorer). Mention privacy. | "Real on-chain settlement — and the transfer is private, off the public ledger." | 🟢 + 🕶️ **Unlink** |
| 2:10 | Try to **publish / leave a ★ review** → World ID gate appears. Verify with World App. | "To publish or review, you prove you're a real human — so the marketplace can't be gamed by bots. One human, one account." | 🌍 **World** |
| 2:40 | Tap the jam's **name tag** → `tipjar.<you>.superjam.eth` → opens the explorer/resolver. | "And every jam is named on ENS — `tipjar.me.superjam.eth` — owned, discoverable, resolvable in any ENS tool." | 🏷️ **ENS** |
| 2:55 | Land on the jam wearing its name tag. | **The closing line.** | — |

---

## Fallbacks (pre-rehearse — judging is unforgiving)
- **Live agent build flakes / is slow:** switch to a **pre-built, pre-deployed jam**
  already in Discover (e.g. *Spending Explainer* — a real agent-built app: "drop a CSV
  of expenses, AI explains it with a chart"; or the *Guestbook*). Narrate the same
  beats on it. Never wait on a spinner on stage.
- **Wallet/login hiccup:** have a second device + a pre-logged-in session ready.
- **World App / verification slow:** show it's wired; if it stalls, cut to the backup
  video for that beat and keep moving.
- **Network:** phone hotspot as backup; the 30-sec recording covers a total failure.

## Pre-demo checklist
- [ ] Clean/incognito browser, logged out (to show login fresh) OR pre-logged for speed.
- [ ] One agent-built jam already live in Discover (the fallback).
- [ ] Server wallet funded with USDC for the tip; recipient set.
- [ ] World App on the demo phone, ready to scan.
- [ ] The 30-sec backup recording on the machine + the deck.
- [ ] Environment frozen — no other deploys mid-demo.

## What the designer can help with
- A **lower-third / cue card** overlay for the recording showing the current beat +
  sponsor (so judges instantly see which prize each moment hits).
- A clean **title + end card** for the backup video (brand-styled).
- Optional: animate the "name tag hanging on the jam" moment — it's the signature image.
