"use client";

// Onchain Wrapped — a Spotify-Wrapped-style recap of a wallet's year onchain.
// Ships with curated demo wallets (baked stats → never fails on stage); Gemini
// narrates a punchy recap live. Charts are real recharts. share.link to brag.
import type { SuperJamSdk } from "../../lib/superjam-sdk";
import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis } from "recharts";
import { JamPage } from "../../lib/jam";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

interface Wallet {
  key: string;
  handle: string;
  emoji: string;
  txs: number;
  gasUsd: number;
  topToken: string;
  topProtocol: string;
  newProtocols: number;
  byMonth: number[];
  fact: string;
}

const WALLETS: Wallet[] = [
  {
    key: "degen", handle: "the.degen", emoji: "🐸",
    txs: 4127, gasUsd: 8420, topToken: "PEPE", topProtocol: "Uniswap",
    newProtocols: 38, byMonth: [120, 210, 540, 880, 760, 410, 300, 220, 180, 160, 90, 60],
    fact: "Aped into 38 new protocols. Survived 31.",
  },
  {
    key: "saver", handle: "steady.eth", emoji: "🏦",
    txs: 142, gasUsd: 96, topToken: "USDC", topProtocol: "Aave",
    newProtocols: 4, byMonth: [10, 12, 9, 14, 11, 13, 10, 12, 15, 11, 13, 12],
    fact: "98% of activity was just moving USDC. Respect.",
  },
  {
    key: "builder", handle: "ship.eth", emoji: "🛠️",
    txs: 921, gasUsd: 1340, topToken: "ETH", topProtocol: "Safe",
    newProtocols: 17, byMonth: [40, 55, 70, 110, 95, 130, 160, 120, 60, 50, 20, 11],
    fact: "Deployed 9 contracts. One actually shipped.",
  },
];

function WrappedApp({ sdk }: { sdk: SuperJamSdk }) {
  const [w, setW] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState<{ title: string; blurb: string } | null>(null);

  async function pick(wallet: Wallet) {
    setW(wallet);
    setRecap(null);
    setBusy(true);
    try {
      const { text } = await sdk.ai.chat(
        [
          {
            role: "system",
            content:
              "You write playful 'onchain wrapped' year-in-review recaps. Given wallet stats, reply " +
              "ONLY as JSON: {\"title\": a 2-3 word persona title, \"blurb\": a punchy 2-sentence recap " +
              "with 1-2 emojis}. No prose outside JSON.",
          },
          {
            role: "user",
            content: `Wallet ${wallet.handle}: ${wallet.txs} txns, $${wallet.gasUsd} gas, top token ${wallet.topToken}, top protocol ${wallet.topProtocol}, ${wallet.newProtocols} new protocols. Fun fact: ${wallet.fact}`,
          },
        ],
        { json: true }
      );
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        setRecap({ title: String(j.title ?? "Onchain Legend"), blurb: String(j.blurb ?? wallet.fact) });
      } catch {
        setRecap({ title: "Onchain Legend", blurb: text.slice(0, 200) });
      }
    } catch {
      setRecap({ title: "Onchain Legend", blurb: wallet.fact });
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    try {
      const { url } = await sdk.share.link({ data: { wallet: w?.key ?? "" } });
      await navigator.clipboard?.writeText(url);
      sdk.ui.toast("Link copied — go flex 🎁");
    } catch {
      sdk.ui.toast("couldn't make a link");
    }
  }

  const chart = w ? w.byMonth.map((v, i) => ({ m: MONTHS[i], v })) : [];

  return (
    <div className="sj-wrap">
      <div className="tj-card">
        <h1 className="tj-title">🎁 Onchain Wrapped</h1>
        <p className="tj-sub">Your year onchain, recapped by AI. Pick a wallet:</p>
        <div className="tj-row" style={{ flexWrap: "wrap" }}>
          {WALLETS.map((x) => (
            <button key={x.key} className="tj-pill" data-on={w?.key === x.key} onClick={() => pick(x)}>
              {x.emoji} {x.handle}
            </button>
          ))}
        </div>
      </div>

      {w && (
        <div className="tj-card">
          <div className="tj-center">
            <div style={{ fontSize: 44 }}>{w.emoji}</div>
            {busy ? (
              <div className="tj-spin" />
            ) : (
              <>
                <span className="tj-badge">{recap?.title ?? "…"}</span>
                <p style={{ fontWeight: 700, margin: "6px 0 0" }}>{recap?.blurb}</p>
              </>
            )}
          </div>

          <div className="tj-grid2" style={{ marginTop: 16 }}>
            <Stat n={w.txs.toLocaleString()} l="transactions" />
            <Stat n={`$${w.gasUsd.toLocaleString()}`} l="gas burned" />
            <Stat n={w.topToken} l="top token" />
            <Stat n={`${w.newProtocols}`} l="new protocols" />
          </div>

          <p className="tj-sub" style={{ margin: "16px 0 0" }}>Activity by month</p>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF4D6D" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#FF4D6D" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <XAxis dataKey="m" stroke="#6B6478" fontSize={10} interval={0} />
              <Area type="monotone" dataKey="v" stroke="#FF4D6D" strokeWidth={2} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>

          <button className="tj-btn" style={{ width: "100%", marginTop: 8 }} onClick={share}>
            Share my wrapped 🎁
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="tj-card tj-center" style={{ background: "var(--bg)", padding: 14 }}>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{n}</div>
      <div className="tj-muted" style={{ fontSize: 12, fontWeight: 700 }}>{l}</div>
    </div>
  );
}

export default function Page() {
  return <JamPage render={(sdk) => <WrappedApp sdk={sdk} />} />;
}
