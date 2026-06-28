# Recipe onchain — games whose state/rewards live on Arc

The jam plays against its OWN smart contract on **Arc**. A **vetted contract is ALREADY
seeded + filled** at `contracts/src/Game.sol` (one of the chance / tic-tac-toe / collectible
templates, chosen from the spec) and a **working starter `app/page.tsx`** is in place. The
harness compiles + deploys the contract and the platform resolves its address — you reach it
through `sdk.onchain`, **gasless** (the server wallet is the operator + pays gas) and
**player-stamped** (the platform injects the real player; you never pass "who"). Manifest
capability: **"onchain"** (skill `onchain`).

## DO NOT rewrite the Solidity
The seeded `contracts/src/Game.sol` is correct, compile-tested, and operator-gated. **Leave it
as-is.** Your job is the **game UI in `app/page.tsx`** (and only the trailing args you pass to
its functions). Don't add imports/OpenZeppelin, don't change the contract name `Game`, don't
touch `contracts/deploy.sh`. If the starter's contract function names don't fit your idea, work
WITH them — they already cover flip/dice/wheel (`play`/`statsOf`), tic-tac-toe (`move`/`state`/
`reset`), and mint (`mint`/`balanceOf`).

## The frontend (this is your job)
- Connect on mount (`await SuperJam.connect()` → `sdk.app.context()`), and gate the onchain
  actions on `!sdk.standalone` — show an "open inside SuperJam" state otherwise. The starter
  already wires this.
- Play GASLESSLY: `await sdk.onchain.write({ fn, args })` for a move (NEVER pass the player
  address — it's auto-stamped as arg 0; pass only the trailing args), `await sdk.onchain.read({ fn,
  args })` for state. Wrap both in try/catch; show a pending state on write, then re-`read`.
- Big integers come back from `read` as **decimal strings** — `Number(x)` / `BigInt(x)`.
- Gate value-ish / mint actions on `ctx.user.worldVerified`.
- STYLE: use the immersive Stage theme (`.tj-app`/`.tj-card`/`.tj-btn`/`.tj-choice`/`.tj-stat`/`.tj-header`),
  the dark glow stage with light text — never a light page. The starter already does; make it FEEL
  good (a roll/flip animation, `tj-pop`/`tj-celebrate` on a win, a `tj-stagger` entrance, minted-badge art).

## For escrowed USDC bets
This recipe's contracts are FREE (operator-relayed, no money). For staked/wager games use the
USDC money layer (`sdk.payments` / `sdk.pot`, see `market.md`) — stake into escrow, play, pay out
the winner. For plain leaderboards (no contract) use `game.md` (`sdk.data.counter`) — cheaper.
