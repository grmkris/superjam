// Seed jam — Tip Jar (payments + a tips leaderboard counter).
// e2e test fixture: payUSDC → confirm sheet → tips counter → social proof.
import { useEffect, useState } from "react";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

const PRESETS = [0.5, 1, 5];

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const tips = sdk.data.counter("tips");
  const [top, setTop] = useState<{ key: string; value: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [raised, setRaised] = useState(0);

  async function refresh() {
    const t = await tips.top(10);
    setTop(t);
    setRaised(t.reduce((s, r) => s + r.value, 0));
  }
  useEffect(() => { void refresh(); }, []);

  async function tip(amount: number) {
    setBusy(true);
    try {
      await sdk.payments.payUSDC({ amount: amount.toFixed(2) }); // → app treasury, private
      await tips.increment(me, amount);                          // opt-in social proof
      sfx.win();
      await refresh();
      sdk.ui.toast(`Thanks for the ${amount} USDC! 💝`);
    } catch (e) {
      if ((e as { code?: string }).code !== "USER_REJECTED") sdk.ui.toast("Payment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Tip Jar 🫙</h1>
      <p className="tj-sub">Buy the squad a round — every tip is private.</p>
      <div className="tj-stat tj-center" style={{ marginBottom: 12 }}>${raised.toFixed(2)} raised</div>
      <div className="tj-row" style={{ justifyContent: "center" }}>
        {PRESETS.map((a) => (
          <button key={a} className="tj-btn" disabled={busy} onClick={() => tip(a)}>
            ${a}
          </button>
        ))}
      </div>
      <ul className="tj-list">
        {top.map((r) => (
          <li key={r.key} style={r.key === me ? { color: "var(--accent)" } : undefined}>
            <b>@{r.key}</b>
            <span className="tj-muted" style={{ marginLeft: "auto" }}>${r.value.toFixed(2)}</span>
          </li>
        ))}
        {top.length === 0 && <div className="tj-empty">Be the first to tip ⚽</div>}
      </ul>
    </div>
  );
}
