# Superjam Toybox → spec feedback (sponsor surfaces)

For the spec writer: the design direction is **superjam "Toybox"** — light, playful,
hand-made (Baloo 2, chunky 2px outlines, sticker shadows), NOT the dark-first
TurboJam described in DESIGN_BRIEF §2. Apps are called **jams**; tabs are
Make · Discover · Inbox; discovery is a TikTok-style vertical feed, not a grid.
DESIGN_SPONSORS.md surfaces were all kept, but several are translated. Please
fold these into the next spec/brief revision:

## Deliberate deviations

1. **Explore grid → vertical feed.** There is no marketplace grid, so the
   "source: DB / ENS ⛓" control becomes **on-chain mode**: a small `app | ⛓ chain`
   flip in the feed header. In chain mode every feed card shows its **back** —
   a trading-card-style dark face listing the raw ENS records (name, url, avatar,
   category, remixOf, by) in mono, caption "reading from Base — no database in
   the loop". Demo line unchanged: "delete our database and this still renders."
   Loading state: "resolving records…" skeleton on the next card peeking in.

2. **EnsChip → name tag.** ENS names render as a quiet sticker shaped like a
   toy's name tag (punched hole + mono text), not a plain mono chip. States kept:
   minted (tag + green ✓) / pending (the making screen gets an extra step,
   **"Hanging the name tag ⛓ .kris.superjam.eth"**) / failed = tag absent.

3. **VerifiedBadge.** One glyph everywhere: a small green ✓ sticker beside
   @names (cards, crew, inbox, leaderboards, confirm sheet recipient). Review
   badges read "✓ human". Leaderboard caption: "all real humans ✓".

4. **Confirm sheet stays Toybox**, not institutional. The trust boundary is
   marked instead by a "🔒 superjam confirm" chip in the sheet header + the
   existing "asked for by <jam> — jams never touch your wallet" explainer line.
   Everything else from §3 kept: app attribution, plain USDC amounts, ≤25 USDC cap.

5. **Agent identity panel → "maker's badge."** Toybox hides AI talk in the make
   flow, so the ENSIP-25/26 panel lives behind a collapsible "who's making this?"
   chip on the making screen. It's styled as a workshop staff badge on a lanyard:
   `builder.superjam.eth` · registered on-chain ✓ (ERC-8004) · backed by a real
   human ✓ (@kris · World) · jams-built stat. Trust hierarchy reads top-to-bottom
   as specced.

6. **Trial gate copy:** "Verify you're human to keep jamming." (not "building").
   Big QR card + "scan with World App · ~30 seconds, one time" + below-fold
   one-liner "keeps superjam human — no spam jams, no bot hi-scores."

7. **Naming (changed in round 4):** hierarchical family model on
   **superjam.eth**, replacing turbojam.eth. Users claim `name.superjam.eth` at
   signup (a claim-your-name screen right after Dynamic email login), and every
   jam auto-mints UNDER its maker: `tipjarplus.kris.superjam.eth`,
   `game2.kris.superjam.eth`, … Provenance is readable from the name itself —
   the user's node is the family tree, jams are its leaves.

8. **Remix lineage:** "🔁 remix of <parent>" chip on feed cards next to the name
   tag; remixOf row visible on the card back in chain mode.

9. **Screen order (round 4):** the canonical first-run walkthrough is
   Welcome (email → wallet appears → claim your name) → Discover → Make →
   Crew & inbox, with money + sponsor moments after. The name mint moved from
   the post-build reveal to signup; the post-build sheet now only picks the
   jam's slug under the already-claimed name.

## Slot-3 seams reserved (nothing visible yet)
- The **name-tag row** on reveal/feed cards fits one more tag (e.g. "stored on
  Walrus").
- The **making-steps list** fits one more row (e.g. "⏸ waiting for operator
  approval on Ledger → ✓").

## Not designed yet (spec'd but pending)
- /me wallet block (USDC balance hero), pay-to-review flow, /manage records
  table with Retry, success-return celebration after World verify, similar-apps
  interrupt.
