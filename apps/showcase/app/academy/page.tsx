"use client";

// Stablecoin Academy — a 60-second explainer of USDC + Circle's rails, a tiny
// fee-comparison chart, a real "ask the professor" AI box (Gemini), and an
// optional 0.5 USDC tip (the payment FLOW shows; settlement is mocked in DEMO_MODE).
import type { SuperJamSdk } from "../../lib/superjam-sdk";
import { useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis } from "recharts";
import { JamPage } from "../../lib/jam";

const STEPS = [
  { e: "💵", t: "USDC is a digital dollar", b: "A stablecoin issued by Circle, 1:1 backed by cash & short-term treasuries. $1 in, $1 out — fully redeemable." },
  { e: "⚡", t: "Circle Gateway", b: "Spend one unified USDC balance across many chains instantly — no manual bridging, the balance just works wherever you are." },
  { e: "🔥", t: "CCTP moves it natively", b: "Cross-Chain Transfer Protocol burns USDC on the source chain and mints it on the destination — no risky wrapped IOUs." },
  { e: "🕶️", t: "Private by default", b: "On SuperJam, tips & pots settle over a shielded rail — amounts move without broadcasting who paid whom." },
] as const;

// Illustrative only — typical cost to move $100.
const FEES = [
  { name: "Bank wire", usd: 25 },
  { name: "Card", usd: 3.2 },
  { name: "USDC", usd: 0.01 },
];
const FEE_COLORS = ["#FF4D6D", "#FFC940", "#2FD180"];

function AcademyApp({ sdk }: { sdk: SuperJamSdk }) {
  const [step, setStep] = useState(0);
  const [q, setQ] = useState("");
  const [a, setA] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tipped, setTipped] = useState(false);

  async function ask() {
    if (!q.trim() || busy) return;
    setBusy(true);
    setA(null);
    try {
      const { text } = await sdk.ai.chat([
        {
          role: "system",
          content:
            "You are a friendly stablecoin professor. Answer ONLY questions about stablecoins, " +
            "USDC, Circle, CCTP, and onchain payments, in 2-3 plain-English sentences. If asked " +
            "something off-topic, gently steer back to stablecoins.",
        },
        { role: "user", content: q.trim() },
      ]);
      setA(text);
    } catch {
      setA("The professor stepped out — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function tip() {
    try {
      await sdk.payments.payUSDC({ amount: "0.50" });
      setTipped(true);
      sdk.ui.toast("Thanks for the tip! 🎓");
    } catch {
      sdk.ui.toast("tip cancelled");
    }
  }

  const s = STEPS[step]!;
  return (
    <div className="sj-wrap">
      <div className="tj-card">
        <h1 className="tj-title">🎓 Stablecoin Academy</h1>
        <p className="tj-sub">Understand USDC in 60 seconds.</p>

        <div className="tj-card tj-center" style={{ background: "var(--bg)", minHeight: 150 }}>
          <div style={{ fontSize: 44 }}>{s.e}</div>
          <b style={{ fontSize: 18 }}>{s.t}</b>
          <p className="tj-muted" style={{ fontSize: 14, fontWeight: 600 }}>{s.b}</p>
        </div>

        <div className="tj-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <button className="tj-btn tj-btn-ghost" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0}>
            ‹ Back
          </button>
          <span className="tj-muted" style={{ fontWeight: 700 }}>{step + 1} / {STEPS.length}</span>
          <button className="tj-btn" onClick={() => setStep((x) => Math.min(STEPS.length - 1, x + 1))} disabled={step === STEPS.length - 1}>
            Next ›
          </button>
        </div>
      </div>

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>What $100 costs to move</h2>
        <p className="tj-sub">Illustrative — lower is better.</p>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={FEES} margin={{ top: 20 }}>
            <XAxis dataKey="name" stroke="#6B6478" fontSize={11} />
            <Bar dataKey="usd" radius={[6, 6, 0, 0]}>
              {FEES.map((_, i) => <Cell key={i} fill={FEE_COLORS[i]} />)}
              <LabelList dataKey="usd" position="top" fontSize={11} fontWeight={700} formatter={(v) => `$${v}`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>🧠 Ask the professor</h2>
        <p className="tj-sub">Real answers about stablecoins.</p>
        <div className="tj-row">
          <input
            className="tj-input"
            placeholder="e.g. how is USDC different from USDT?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
          />
          <button className="tj-btn" onClick={ask} disabled={busy || !q.trim()}>
            {busy ? "…" : "Ask"}
          </button>
        </div>
        {a && (
          <div className="tj-card tj-pop" style={{ background: "var(--bg)", marginTop: 12, fontWeight: 600 }}>
            {a}
          </div>
        )}

        {!sdk.standalone && (
          <button className="tj-btn" style={{ width: "100%", marginTop: 14, background: "#FFC940", color: "var(--text)" }} onClick={tip} disabled={tipped}>
            {tipped ? "Tipped 🎓" : "Tip the professor · 0.5 USDC"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <JamPage render={(sdk) => <AcademyApp sdk={sdk} />} />;
}
