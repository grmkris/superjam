# S4 — Wiring the StakeSlash escrow into the live build flow (handoff)

**Status:** the escrow is DEPLOYED + lifecycle-proven LIVE on Arc (see
`docs/bounties/circle-1-advanced-stablecoin.md`), and its viem bindings + the
delivery judge are written + unit-tested — but **nothing in the api calls them
yet**. This doc is the precise cross-lane wiring map so the in-app economic loop
(build escrows price + builder bond → judged → release/slash → yield → treasury)
can be turned on as a coordinated pass. It is NOT a solo task — it spans the db,
builds, agents, judge, and onchain lanes.

Owner of this doc: Opus C (Chain & Payments). Reach me via PIVOT.md / memory.

## What already exists (don't rebuild)

- **Bindings** — `createStakeSlash({ address, serverWallet, publicClient })`,
  importable today from `@superjam/onchain/staking` (the `./staking` subpath is
  already exported in `packages/onchain/package.json` — no root re-export needed).
  Surface (`packages/onchain/src/staking/stake-slash.ts`):
  - `registerBuild(apiBuildId, builder, price, bond) → Promise<Hex>`
  - `markDelivered(apiBuildId) → Promise<Hex>`
  - `resolve(apiBuildId, slashBuilder, delist) → Promise<Hex>` (arbiter ruling)
  - `freeStake(builder) → Promise<Usdc>`, `getBuild(apiBuildId) → OnchainBuild | null`
  - `buildKey(apiBuildId)` keys the on-chain build by `keccak256(apiBuildId)`.
- **Judge** — `decideDelivery(deployGate, aiScore) → JudgeOutcome` and
  `resolveChallenge(...)` (`packages/onchain/src/staking/judge.ts`), plus
  `runDeployGate` / `probeReachability` / `scoreToVerdict`. The `JudgeOutcome`
  maps directly onto `resolve(slashBuilder, delist)`.
- **Contract** — StakeSlash live on Arc `0x90E8C7da6AA73d0000ffa9fC0cb906Df2aeEc4E6`
  (+ SimpleYieldVault `0x020d3C641b6Fd1edf1c04Dc813829086FB0e1266`); arbiter = the
  server wallet.

## What's MISSING (the actual work, by lane)

1. **Builder staking-deposit flow — DOES NOT EXIST (blocker).**
   `registerBuild` *locks a bond from the builder's existing stake*; there is no
   binding/route for a builder to `deposit()` USDC stake in the first place. Needs:
   a `deposit`/`withdraw` binding in `stake-slash.ts` (**K's lane**) + an api route
   for a builder/agent to fund its stake (**Chain & Payments + agents lane**).

2. **DB columns on the build row — A's lane.** `builds` needs:
   `price`, `builderWallet`, `bond`, `escrowTxHash`, `paidTxHash` (and confirm an
   `agentId`/`routedAgentId` already persists). Without these the hooks below have
   nothing to read/write.

3. **`onchain.stakeSlash` binding on the adapter — Chain & Payments (me).**
   Recommended recipe (in `packages/onchain/src/index.ts` `createOnchain` +
   `createOnchainFromConfig`): add `stakeSlashAddress?: string` to `OnchainConfig`;
   when set, build `createStakeSlash({ address, serverWallet, publicClient })` using
   the **Arc** `publicClient` + `serverWallet` (NOTE: `StakeSlashDeps.address`'s
   comment says "Base Sepolia" — stale from before the all-Arc flip; the escrow is
   on Arc, so pass the Arc clients) and expose it as `onchain.stakeSlash`. Source the
   address from `STAKE_SLASH_ADDRESS` env (already in `.env.example`). I'll do this
   the moment the rest is greenlit — left out now to avoid shipping a dead binding.

4. **Inject `stakeSlash` into the request context — shared.** Add to `ApiContext`
   + `createContext(...)` (`packages/api/src/context.ts`) and pass it from
   `apps/server/src/server.ts`. ⚠️ `server.ts` is the **Dynamic agent's hot file**
   (signer wiring) — coordinate, don't collide.

## Exact hook points (current line numbers, `packages/api/src/routers/builds.ts`)

- **registerBuild** — after a build row is created + the app is allocated/linked
  (`builds.create`, ~**312–333**, right after `allocateExternalApp` → `build.appId`).
  Call `onchain.stakeSlash.registerBuild(buildId, builderWallet, price, bond)` and
  persist the returned tx hash to `escrowTxHash`. Requires the builder to have
  staked (missing flow #1) + the price/bond columns (#2).
- **markDelivered** — in `runBuild` (~**165–218**) right after the deploy succeeds
  and status flips to `done` (~**185**). `onchain.stakeSlash.markDelivered(buildId)`.
- **judge → resolve** — feed the deploy gate + AI score into
  `decideDelivery(...)` (judge.ts:**94–113**); on a bad delivery call
  `onchain.stakeSlash.resolve(buildId, slashBuilder, delist)`. A clean, unchallenged
  delivery is released by the contract's permissionless `finalize` after the
  challenge window (no api call needed) — note there is no `finalize` *binding* today;
  add one to `stake-slash.ts` only if the api needs to force-finalize.
- **app.builtByAgentId** — set on finalize/success (**A's `apps.ts`**).

## Suggested sequencing (smallest safe slices)

1. A: add the db columns. 2. K: add `deposit`/`withdraw` (+ `finalize`) bindings.
3. Me: `onchain.stakeSlash` adapter binding + context injection (coord. Dynamic agent).
4. Me/agents: the builder staking-deposit route. 5. S: the three `builds.ts` hooks
   (registerBuild / markDelivered / judge→resolve). 6. End-to-end on Arc with a tiny
   stake, like the S3 lifecycle proof.

Until all of 1–5 land, leave the bindings uncalled — a half-wired escrow that
locks real USDC without a delivery/dispute path is worse than none.
