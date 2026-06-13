# Turbojam Architecture

_Started 2026-06-12 01:04 UTC_

---

## User

GitHub connected

## Assistant

GitHub is connected! Paste a github.com repo URL and I'll explore its structure, pull in the files we need — components, styles, design tokens — and use them as reference for design mockups or new screens.

## User

https://github.com/grmkris/turbojam-poc

## Assistant

_[tool: github_get_tree]_

_[tool: list_files]_

_[tool: github_get_tree]_

_[tool: github_list_repos]_

_[tool: github_prompt_install]_

An install banner just appeared above — click it and grant the app access to **grmkris/turbojam-poc** (you can scope it to just that repo). Once that's done, send me a quick message and I'll pull the repo in.

## User

done

## Assistant

_[tool: github_get_tree]_

_[tool: github_get_tree]_

_[tool: github_read_file]_

_[tool: github_read_file]_

_[tool: github_get_tree]_

Got it — the repo is accessible now (default branch is `master`). Let me explore.

_[tool: github_get_tree]_

_[tool: list_files]_

_[tool: github_import_files]_

_[tool: github_get_tree]_

_[tool: github_import_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: questions_v2]_

## User

Questions answered:
- deliverable: Redesign the platform UI (wizard, gallery, viewer), A brand identity / visual direction first, Pitch/demo deck for judges
- scope_screens: Home / build wizard (idea → questions → spec → build feed), Apps gallery + viewer, Mini-app template look, Friends + Inbox, Wallet confirm sheet (USDC payment)
- direction: Decide for me
- vibe: Playful arcade — mini apps as toys
- variations: 2–3 directions side by side
- fidelity: Hi-fi static screens
- desktop_mobile: Mobile-first (mini apps feel like phone apps)

## Assistant

_[tool: list_files]_

_[tool: github_import_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: update_todos]_

_[tool: copy_starter_component]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: dc_write]_

_[tool: dc_html_str_replace]_

Now Direction 1's phones — wizard + agent build feed first:

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Direction 1 complete. Now Direction 2 — **Toybox** (light, sticker-pop):

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: done]_

_[tool: fork_verifier_agent]_

All three directions are up — 12 phone screens total, each direction with its brand strip (logo, palette, type):

1. **Night Arcade** — the evolution of your current dark + mint, turned up with neon glow, Unbounded display type, and magenta/coin-yellow accents.
2. **Toybox** — full reinvention: cream paper, thick ink outlines, hard offset shadows, candy primaries, Baloo 2. Boldest on a projector.
3. **Pocket Console** — phone as a 90s handheld: lavender plastic, console-button colors, pixel labels, apps as cartridges, build feed as a loading screen.

Each shows the build wizard, agent build feed, gallery, and the USDC confirm sheet over a running Tip Jar.

One note: I branded everything **superjam** (lowercase wordmarks) following your project rename — say the word if it should stay TurboJam. Pick a direction (or a mix) and I'll build the full screen set — friends, inbox, mini-app theme — plus the judges' deck in that identity.

## User

let's go with toybox approach, i also put some comments, let's now go detailed all screen and also include my coments in consideration

## Assistant

_[tool: list_files]_

_[tool: grep]_

_[tool: list_files]_

_[tool: grep]_

_[tool: read_file]_

_[tool: eval_js_user_view]_

The comments are anchored to two spots; let me retrieve their text from your view:

_[tool: eval_js_user_view]_

I can see where your two comments are pinned — one on the **build-feed console** (Agent at work screen) and one on the **gallery content** (The toybox screen) — but the comment text itself doesn't come through to me. Could you paste or summarize what the two comments say? 

Meanwhile, to make sure the detailed pass lands right, here's what I'll build in the Toybox identity once I have your notes:

1. **Build wizard** (idea → questions → spec confirm)
2. **Agent at work** (build feed)
3. **Apps gallery** + **app viewer**
4. **Wallet confirm sheet**
5. **Friends** and **Inbox** (new)
6. **Mini-app template theme** — what generated apps look like inside (the SDK's `theme.css` re-skinned as Toybox)

## User

what do you need from me?

## Assistant

Just the text of the two comments you left on the design. I can see *where* you pinned them, but not what they say:

1. One on the **dark console/build-log box** in the "Agent at work" screen (Toybox direction)
2. One on the **Apps gallery screen content** ("The toybox")

If you can paste what you wrote in those two comments (or just summarize), I'll fold them into the detailed build-out of all screens right away.

## User

Address these comments from my teammates:

**Kristjan**:
<teammate-comment>let's go with toybox design approach</teammate-comment>

**Kristjan** (on `Superjam Directions.dc.html` at `[data-comment-anchor="e24aa1164b-div"]`):
<teammate-comment>maybe the creations could be discoverable tiktok style?</teammate-comment>

**Kristjan** (on `Superjam Directions.dc.html` at `[data-comment-anchor="b2a967c8da-div"]`):
<teammate-comment>i don't like coding/AI related conceptss.. this needs to be hidden for the user</teammate-comment>

## Assistant

_[tool: update_todos]_

_[tool: dc_write]_

Got it — three clear notes:

1. ✅ **Toybox** it is
2. **Discovery = TikTok-style** vertical feed, not a grid
3. **Hide all coding/AI machinery** — no file names, build logs, terminals, or "agent" talk; the making process should feel like a toy workshop, not a compiler

Building the full detailed set now in a new file:

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Create flow done. Now Section 2 — the TikTok-style Discover feed:

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Section 3 — the mini-app template look + payment:

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Section 4 — Friends + Inbox:

_[tool: dc_html_str_replace]_

_[tool: done]_

_[tool: update_todos]_

_[tool: fork_verifier_agent]_

Full Toybox set is up — **10 screens in 4 sections**, with both teammate comments baked in:

**1 · Create** — wizard → "Here's the plan" (features as *what's inside* the toy) → **Making it**: no build log, no file names, no AI talk — just workshop steps ("Shaping the jar", "Fitting the coin slot") with a candy progress bar → a confetti reveal screen.

**2 · Discover** — TikTok-style: one toy full-screen with heart/scores/share/remix rail and the next toy peeking from below; second phone shows a toy being *played live inside the feed* (it's an app, not a video — the differentiator vs TikTok).

**3 · Play & pay** — the default theme generated toys inherit, plus the USDC confirm sheet (the only wallet surface).

**4 · Crew** — friends ("add once, play everywhere") and the inbox as mail from toys, deep-linking back.

I also renamed the tabs to **Make / Discover / Friends / Inbox** — "Build" felt like dev-speak too.

Next up whenever you're ready: the judges' deck in this identity, or a clickable prototype of the make → reveal → share loop.

## User

Address these comments from my teammates:

**Kristjan**:
<teammate-comment>should we call it instead of the toy, a jam ? </teammate-comment>

**Kristjan** (on `Superjam Toybox.dc.html` at `[data-dc-tpl="130"]`):
<teammate-comment>can we somehow have a live preview of how the app ui is being generated? that's a stretch goal but it would be awesome..</teammate-comment>

**Kristjan** (on `Superjam Toybox.dc.html` at `[data-dc-tpl="88"]`):
<teammate-comment>maybe have refine option? where user can go back and forth a bit</teammate-comment>

**Kristjan** (on `Superjam Toybox.dc.html` at `[data-dc-tpl="100"]`):
<teammate-comment>i'd like to have just Make Discover Inbox I think....</teammate-comment>

## Assistant

_[tool: eval_js_user_view]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: done]_

Now the remaining "toy → jam" renames and crew/footer copy:

_[tool: fork_verifier_agent]_

All four comments are in:

1. **"Jam" naming** — adopted everywhere: "Make a jam. Share the jam.", "Making your jam…", "swipe for the next jam", "jams never touch your wallet". It pairs nicely with superjam *and* the Tip **Jar** demo app.
2. **Live preview while generating** — the making screen now centers on a mini phone canvas where the jam's UI paints in piece by piece: header and coin buttons already real, note field and leaderboard still dashed skeleton, with a "🖌️ painting…" badge. (Noted it as the stretch goal in the footer — it degrades gracefully to skeleton + steps if live rendering isn't feasible.)
3. **Refine loop** — the plan screen now reads "Go back and forth until it feels right," with a ✏️ "change anything" input and an example of it working: the leaderboard row shows "Monthly top-tipper board" with an "updated ✏️" tag.
4. **Three tabs** — every phone is now Make · Discover · Inbox. The crew screen moved behind the profile chip (@kris ▾) instead of a tab.

Want the judges' deck in this identity next, or a clickable prototype of the make → reveal → share loop?

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: done]_

Both stragglers fixed — the section heading now reads "Idea → questions → the jam → reveal" and @theo's row says "made 3 jams". The rename is now complete across all 10 screens.

## User

do you know which sponsors we are going for in the project? would be good to include those in the screens as well

## Assistant

_[tool: grep]_

_[tool: github_get_tree]_

_[tool: github_read_file]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: done]_

_[tool: grep]_

One edit (the World ID badge) didn't land — checking the exact current markup:

_[tool: dc_html_str_replace]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Sponsors found in the repo docs and woven into the screens:

**Locked sponsors (from `CONTEXT.md` / `STRATEGY.md`):**
- **ENS** (Best ENS Integration for AI Agents, $5K) — every jam and every friend is now a `name.superjam.eth` subname: blue pill on the reveal screen (`tipjarplus.superjam.eth ✓`), name pill on the discover feed card, and crew rows show `mira.superjam.eth` instead of raw hex addresses.
- **World** (AgentKit, $7.5K) — under the "Make it!" button: "◉ verified human · World ID — first jam's free", matching the gated-builder + free-trial strategy.
- **USDC** — confirm sheet now notes "USDC on Base."

**Slot 3** is deliberately undecided in your strategy doc (Walrus / Dynamic / Ledger / Hedera / Arc, picked at kickoff), so I left it out of the UI — easy to slot in a surface once you choose (e.g. a Ledger option on the confirm sheet, or a "stored on Walrus" pill on the reveal).

One naming flag: the repo says `*.turbojam.eth`, the designs say `*.superjam.eth` — make sure whichever name you register matches.

## User

we go for ENS, Dynamic, World
So for ENS is that either us the creator would have an ENS name or maybe one can also give their game a subdomain so that's two things and then world id is to make reviews and comments possible below the games and also the creators and this way we can show you clarified whether you're human or not and the dynamic is used to give a nice onboarding experience that's it

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: done]_

Crystal clear — let me realign the sponsor surfaces to those exact roles: ENS = creator names **and** jam subdomains, World ID = human-verified reviews/comments (not build-gating), Dynamic = the onboarding moment. That means removing the World ID line I put under "Make it!", and adding two new screens (onboarding + reviews):

_[tool: fork_verifier_agent]_

Done — new **Section 5 · Sponsor moments** with one hero screen per sponsor, mapped to your exact roles:

- **5a · Dynamic — onboarding**: email field → "Continue", with "✨ a wallet appears with it — nothing to install · no seed phrase · no extension · powered by Dynamic".
- **5b · World ID — reviews**: a jam page with a Reviews section — "★ 4.8 · 31 humans", every commenter *and* the creator (@mira) wears a "◉ human" badge, and the comment box says "prove you're human once with World ID — no bots in here".
- **5c · ENS — both things**: a "Give it an address 🏷️" sheet on the reveal — claim `tipjarplus.superjam.eth` (✓ free) for the jam, plus a "made by **kris.eth**" row showing the creator's own ENS name rides on every jam.

Also adjusted per your clarification: removed the World ID gate from the "Make it!" button (it's for reviews, not building), and the crew list now shows the mixed story — `mira.eth` (brings her own ENS) next to `theo.superjam.eth` (got a subname).

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: done]_

Fixed — the email placeholder is now "your email…", which sidesteps the email-protection rewriter that was turning it into a blue "[email protected]" link. Everything else verified clean: all 18 screens render, no naming stragglers, and all three sponsor surfaces are in place.

