# Sponsor Integration UI

_Started 2026-06-12 18:43 UTC_

---

## User

please pull the latest https://github.com/grmkris/turbojam-poc repo there u will see we added some more informations about sponsors and how they would be integrated, please go through them and brainstorm with me, how to put them in UI so that it makes UX sense ..

## Assistant

_[tool: github_get_tree]_

_[tool: list_files]_

_[tool: github_get_tree]_

_[tool: github_read_file]_

_[tool: read_file]_

_[tool: github_read_file]_

_[tool: grep]_

_[tool: questions_v2]_

## User

Questions answered:
- scope: Update existing phones (add ✓ badges, name tags, lineage chips in place), New phones for the big moments (trial gate, card-flip ⛓ mode, maker's badge)
- ens_toggle: not sure what u mean here extactly..  let's explore keep it simple, we can deviate from spec if it makes sense...
- agent_panel: Maker's badge — collapsible, one tap away in the make flow
- ens_register: Quiet name-tag sticker (mono text, small)
- confirm_tone: let's keep toybox i think.. we can give to our spec writer info about our toybox idea, they are unaware
- naming: turbojam.eth
- slot3: idk
- extra: hmm not sure, we can deviate from the spec, but then we need some feedback for spec writer to incporopate this

## Assistant

_[tool: github_read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: snip]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Round 3 is in — the sponsor deep-dive is now woven through the Toybox file, per your answers:

**Updated in place (sections 1–5)**
- **✓-human stickers** beside every @name — feed, crew, inbox, leaderboards, confirm sheet recipient
- **Quiet mono name tags** on `turbojam.eth` — punched-hole sticker style, on the reveal card and feed cards
- **🔁 remix lineage chip** next to the name tag in the feed
- The making list gets an ENS step: *"Hanging the name tag ⛓ .turbojam.eth"* — the spec's "registering" stepper beat, in workshop language
- Confirm sheet stays Toybox but gains the trust boundary: a small **🔒 superjam confirm** chip + the "jams never touch your wallet" line

**Three new phones (section 6)**
- **6a · Trial gate** — big QR legible across a table, "Verify you're human to keep jamming"
- **6b · On-chain mode** — my answer to your "not sure what u mean" on the DB/ENS toggle: since there's no grid, an `app | ⛓ chain` flip makes every feed card show its **back** — a dark trading-card face listing the raw ENS records. Same judge line: *"delete our database and this still renders."*
- **6c · Maker's badge** — the agent identity panel as a collapsible workshop staff badge on a lanyard, one tap from the making screen: named on ENS → registered on-chain → backed by a human

**For your spec writer:** `Spec feedback - sponsor surfaces.md` lists every deliberate deviation (feed instead of grid, name tags instead of chips, Toybox confirm sheet, "jamming" copy, slot-3 seams reserved) — paste it into their next revision.

Open threads worth a look: the **/me wallet block, pay-to-review flow, and the post-verify celebration** are spec'd but not designed yet — want those next, or a second take on the card-back flip (e.g. a whole-feed reskin instead of per-card backs)?

## User

we need to improve the screens.. basically i want to start with onboarding screen... then discover, then make, then inbox.. so reposiitioen them please inside the canvas.. also user receives ens when they signup.. and then each of ther jams gets an ens
game1.kris.superjam.eth
game2.kris.superjam.eth
etc etc etc...

## Assistant

_[tool: run_script]_

Got it — reorder to onboarding → discover → make → inbox, and switch to the family naming model (`kris.superjam.eth` at signup, jams minting under it as `tipjarplus.kris.superjam.eth`). That naming change is actually a nice upgrade for the demo: provenance becomes readable from the name itself. I'll restructure the file and add a "claim your name" screen to onboarding, since the name mint now happens at signup.

_[tool: done]_

_[tool: fork_verifier_agent]_

Done — the file is restructured and the naming model is switched over:

**New order:** 1 · Welcome → 2 · Discover → 3 · Make → 4 · Crew & inbox → 5 · Play & pay → 6 · Sponsor moments → 7 · Deep cuts. All section numbers and phone captions renumbered.

**Family naming model, applied everywhere:**
- New **1b · Claim your name** phone in onboarding — right after the Dynamic email screen, you claim `kris.superjam.eth`, with a preview showing how jams will hang under it (`tipjar.kris.superjam.eth`, `trivia.kris.superjam.eth`…)
- All name tags updated: `tipjarplus.kris.superjam.eth`, `trivianight.mira.superjam.eth`, remix parent `pubquiz.theo.superjam.eth`, agent `builder.superjam.eth`
- The post-build naming sheet is reframed: it now just picks the jam's slug under your already-claimed name
- Chain-mode card back + making-steps updated to match

**Spec feedback doc updated** — deviation #7 rewritten for the hierarchical model (provenance readable from the name itself), plus a new #9 documenting the canonical screen order and that the name mint moved from reveal to signup.

One thought for the spec writer: this model makes remix lineage doubly provable — `remixOf` records *and* the name hierarchy both live on chain. Verifier is checking the long mono names don't overflow the small chips; I'll fix if it flags anything.

## User

No issues found

## Assistant

Verified clean — the new order, the claim-your-name screen, and all the family-model name tags render correctly with no overflow. Nothing else needed this round.

Next candidates when you're ready: the `/me` wallet block (USDC balance hero), the pay-to-review flow, or the post-verify celebration — all spec'd but not yet designed.

