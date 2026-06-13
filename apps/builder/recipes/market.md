# Recipe market — escrowed bets / pots / prediction markets (REAL USDC)

Group wagers the **platform escrows** — predictions, match pots, sweepstakes with real money.
Uses `sdk.pot.*`. Manifest capability: **"payments"**. (For the no-money version, use
`predict.md` instead.)

## LIFECYCLE (know every state)
1. **create** — `sdk.pot.create({ question, options /*2-6*/, deadline?, resolver })`. Creator
   MUST be `sdk.app.context().user.worldVerified` (gate the create button). `resolver:"ai"`
   auto-settles from live data at the deadline; `"creator"` = the host calls it. Pot ≤100 USDC.
2. **stake** — `sdk.pot.stake({ id, option, amount /*≤10*/ })` → host confirm sheet → escrow.
3. **get** — `sdk.pot.get({ id })` → `{ question, options, totals, myStake, status, resolvedOption }`.
   Poll ~5s while `status==="open"`; render `totals[option]` as bars.
4. **resolve** — `sdk.pot.resolve({ id, option })` (creator + worldVerified) → platform pays
   winners pro-rata + inboxes them. Unresolved 48h past deadline ⇒ void (refunds).

## HARD RULES
- Gate **create** on `worldVerified`; anyone may stake.
- NEVER show stake/resolve buttons after `status !== "open"` — show the result instead.
- `amount ≤ 10`; surface live `totals`. Wrap `stake` in try/catch (`USER_REJECTED` on decline).
- `resolver:"ai"` shines on real-world events — phrase the question so a grounded search can
  resolve it ("Who wins the final?").

## Pattern — `app/page.tsx`
```tsx
"use client";
import SuperJam, { type SuperJamSdk, type Pot } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

const OPTIONS = ["Argentina", "France"];
export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [potId, setPotId] = useState<string | null>(null);
  const [pot, setPot] = useState<Pot | null>(null);
  const [canHost, setCanHost] = useState(false);

  useEffect(() => { (async () => {
    const sdk = await SuperJam.connect(); sdkRef.current = sdk;
    setCanHost(sdk.app.context().user.worldVerified);
  })(); }, []);
  useEffect(() => { if (!potId) return;
    const t = setInterval(async () => setPot(await sdkRef.current!.pot.get({ id: potId })), 5000);
    void sdkRef.current!.pot.get({ id: potId }).then(setPot);
    return () => clearInterval(t);
  }, [potId]);

  async function host() {
    const { id } = await sdkRef.current!.pot.create({
      question: "Who wins the final?", options: OPTIONS, resolver: "ai" });
    setPotId(id);
  }
  async function stake(option: string) {
    try { await sdkRef.current!.pot.stake({ id: potId!, option, amount: 2 });
      setPot(await sdkRef.current!.pot.get({ id: potId! })); }
    catch (e) { if ((e as { code?: string }).code !== "USER_REJECTED") sdkRef.current!.ui.toast("Stake failed"); }
  }

  if (!potId) return <main style={{ padding: 24 }}>{canHost
    ? <button onClick={host}>Host the pot</button>
    : <p>Verify with World ID to host a pot.</p>}</main>;
  const open = pot?.status === "open";
  return (
    <main style={{ padding: 24 }}>
      <h1>{pot?.question ?? "…"}</h1>
      {pot && OPTIONS.map((o) => (
        <div key={o}>{o}: ${pot.totals[o] ?? "0"} {open && <button onClick={() => stake(o)}>Stake $2</button>}</div>
      ))}
      {pot?.status === "resolved" && <p>🏆 {pot.resolvedOption} won</p>}
    </main>
  );
}
```
