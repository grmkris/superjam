# SKILL market — escrowed wagers & pots (sdk.pot)

Prediction markets, match pots, sweepstakes, "who's right" bets — all escrowed
by the platform so no one has to trust a friend to pay out. Deps: `sdk.pot`,
`sdk.payments` (the confirm sheet), `sdk.data.counter` (optional draws),
`./lib/sfx`. Requires manifest capability **"payments"**.

## THE LIFECYCLE (know every state)
1. **create** — `sdk.pot.create({ question, options /*2-6*/, deadline?, resolver })`.
   Creator MUST be `ctx.user.worldVerified` (gate the create button on it).
   `resolver: "creator"` (default) = the creator calls the winner; `resolver: "ai"`
   = at the deadline the PLATFORM resolves from live data (search-grounded) and
   auto-pays. Pot total caps at 100 USDC.
2. **stake** — `sdk.pot.stake({ id, option, amount /*≤10*/ })` → confirm sheet →
   USDC into platform escrow. One option per user (let them add more to the same).
3. **get** — `sdk.pot.get({ id })` → `{ question, options, totals, myStake,
   status: "open"|"resolved"|"void", resolvedOption }`. Poll every ~5s while open
   to show the live pool; render `totals[option]` as bars.
4. **resolve** — creator-pots: `sdk.pot.resolve({ id, option })` (CREATOR +
   worldVerified only) → platform pays winners **pro-rata** from escrow + inboxes
   "you won X USDC 🎉". ai-pots resolve themselves at the deadline (creator can
   still override any time). Unresolved 48h past deadline ⇒ **void** = full
   refunds. You don't move money — the platform does; you just call resolve.

## HARD RULES
1. Gate the **create** button on `ctx.user.worldVerified` (show a "verify to host
   a pot" note otherwise). Anyone can stake.
2. NEVER show stake/resolve buttons after `status !== "open"`. Show the result +
   "you won/your refund" instead.
3. `amount ≤ 10` per stake, surface the live `totals` so people see the pool.
4. Wrap `stake` in try/catch — `USER_REJECTED` when they decline the sheet;
   don't retry.
5. ai-resolve shines on REAL-WORLD events (a World Cup match, an election) — say
   so in the question so the grounded search can find the answer.

## The pattern — a match pot that resolves itself

```tsx
import { useEffect, useState } from "react";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

type Pot = Awaited<ReturnType<SuperJamSdk["pot"]["get"]>>;
const OPTIONS = ["Argentina", "France"];

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const [potId, setPotId] = useState<string | null>(null);
  const [pot, setPot] = useState<Pot | null>(null);
  const [busy, setBusy] = useState(false);

  // poll the live pool
  useEffect(() => {
    if (!potId) return;
    const tick = () => sdk.pot.get({ id: potId }).then(setPot);
    void tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [potId]);

  async function host() {
    const { id } = await sdk.pot.create({
      question: "Who wins the final?",
      options: OPTIONS,
      deadline: Date.now() + 2 * 3600_000,
      resolver: "ai",   // auto-settles when the match ends
    });
    setPotId(id);
  }

  async function stake(option: string) {
    if (!potId) return;
    setBusy(true);
    try { await sdk.pot.stake({ id: potId, option, amount: 2 }); sfx.win(); setPot(await sdk.pot.get({ id: potId })); }
    catch (e) { if ((e as { code?: string }).code !== "USER_REJECTED") sdk.ui.toast("Stake failed"); }
    finally { setBusy(false); }
  }

  if (!potId) {
    return (
      <div className="tj-card tj-center">
        <h1 className="tj-title">Match Pot ⚽</h1>
        {ctx.user.worldVerified
          ? <button className="tj-btn" onClick={host}>Host the final pot</button>
          : <p className="tj-muted">Verify with World ID to host a pot.</p>}
      </div>
    );
  }

  const open = pot?.status === "open";
  return (
    <div className="tj-card">
      <h1 className="tj-title">{pot?.question ?? "…"}</h1>
      {pot && OPTIONS.map((o) => (
        <div key={o} style={{ margin: "8px 0" }}>
          <div className="tj-row">
            <b>{o}</b>
            <span className="tj-muted" style={{ marginLeft: "auto" }}>${pot.totals[o] ?? "0"}</span>
          </div>
          {open && <button className="tj-btn" disabled={busy} onClick={() => stake(o)}>Stake $2 on {o}</button>}
        </div>
      ))}
      {pot?.myStake && <p className="tj-badge">your bet: {pot.myStake.option} ${pot.myStake.amount}</p>}
      {pot?.status === "resolved" && <p className="tj-stat">🏆 {pot.resolvedOption} won</p>}
      {pot?.status === "void" && <p className="tj-muted">Void — everyone refunded.</p>}
    </div>
  );
}
```

## Recipes (no new surface)
- **Unique draw / "pick a team"** (collision-free assignment): a counter is
  atomic + sequential — `const n = await sdk.data.counter("draw").increment("seat");`
  then `const team = TEAMS[(n - 1) % TEAMS.length]`. Every caller gets a distinct
  number, so no two users clash.
- **Settle-up fallback** (when you don't want escrow): track who owes whom in a
  `sdk.data.collection`, and at the end let losers tip the winner directly with
  `sdk.payments.payUSDC({ amount, to: winnerUsername })`. Simpler than a pot for
  trusted friend groups; no worldVerified gate, no escrow.
