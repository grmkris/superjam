// Seed jam — Final Pot (escrowed wager: pot.create resolver:"ai" → stake →
// live totals → self-resolving payout). Creating requires World verification.
import { useEffect, useState } from "react";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext, Pot, Json } from "@superjam/sdk";

const OPTIONS = ["Argentina", "France"];
const STAKE = 2;

const asRecord = (v: Json | null): Record<string, Json> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const launch = asRecord(ctx.launch);
  const launchPotId = typeof launch?.potId === "string" ? launch.potId : null;
  const [potId, setPotId] = useState<string | null>(launchPotId);
  const [pot, setPot] = useState<Pot | null>(null);
  const [busy, setBusy] = useState(false);

  // poll the live pool every 5s while open
  useEffect(() => {
    if (!potId) return;
    let alive = true;
    const tick = () => { void sdk.pot.get({ id: potId }).then((p) => { if (alive) setPot(p); }); };
    tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [potId]);

  async function host() {
    setBusy(true);
    try {
      const { id } = await sdk.pot.create({
        question: "Who wins the final?",
        options: OPTIONS,
        deadline: Date.now() + 2 * 3600_000,
        resolver: "ai", // settles itself when the match ends
      });
      setPotId(id);
    } finally { setBusy(false); }
  }

  async function stake(option: string) {
    if (!potId) return;
    setBusy(true);
    try {
      await sdk.pot.stake({ id: potId, option, amount: STAKE });
      sfx.win();
      setPot(await sdk.pot.get({ id: potId }));
    } catch (e) {
      if ((e as { code?: string }).code !== "USER_REJECTED") sdk.ui.toast("Stake failed");
    } finally { setBusy(false); }
  }

  async function invite() {
    if (!potId) return;
    try {
      const { url } = await sdk.share.link({ data: { potId } });
      await navigator.clipboard?.writeText(url);
      sdk.ui.toast("Pot link copied — share it!");
    } catch { sdk.ui.toast("Couldn't copy link"); }
  }

  if (!potId) {
    return (
      <div className="tj-card tj-center">
        <h1 className="tj-title">Final Pot ⚽</h1>
        <p className="tj-sub">Escrowed by SuperJam — it pays out automatically.</p>
        {ctx.user.worldVerified ? (
          <button className="tj-btn" disabled={busy} onClick={host}>Host the final pot</button>
        ) : (
          <p className="tj-muted">Verify with World ID to host a pot.</p>
        )}
      </div>
    );
  }

  const open = pot?.status === "open";
  const total = pot ? OPTIONS.reduce((s, o) => s + Number(pot.totals[o] ?? "0"), 0) : 0;

  return (
    <div className="tj-card">
      <h1 className="tj-title">{pot?.question ?? "Loading…"}</h1>
      <p className="tj-sub">Pool: ${total.toFixed(2)} · stake ${STAKE} a side</p>
      {pot && OPTIONS.map((o) => {
        const amt = Number(pot.totals[o] ?? "0");
        const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
        return (
          <div key={o} style={{ margin: "10px 0" }}>
            <div className="tj-row"><b>{o}</b><span className="tj-muted" style={{ marginLeft: "auto" }}>${amt.toFixed(2)} · {pct}%</span></div>
            <div style={{ height: 8, background: "var(--bg)", border: "2px solid var(--text)", borderRadius: 6, overflow: "hidden", margin: "4px 0" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
            </div>
            {open && <button className="tj-btn" disabled={busy} style={{ width: "100%" }} onClick={() => stake(o)}>Stake ${STAKE} on {o}</button>}
          </div>
        );
      })}

      {pot?.myStake && <p className="tj-badge">Your bet: {pot.myStake.option} · ${pot.myStake.amount}</p>}
      {pot?.status === "resolved" && <div className="tj-stat tj-center" style={{ marginTop: 10 }}>🏆 {pot.resolvedOption} won!</div>}
      {pot?.status === "void" && <p className="tj-muted">Void — everyone was refunded.</p>}

      {open && (
        <button className="tj-btn tj-btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={invite}>Copy invite link 🔗</button>
      )}
    </div>
  );
}
