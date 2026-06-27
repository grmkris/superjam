// tier-list — the "rank these into S/A/B/C" viral kit. Tap an item to cycle its
// tier (no drag library needed), then share your ranking ("here's my take — what's
// yours?"). Rankings are opinion bait — perfect share fuel. Zero-backend:
// sdk.storage (your ranking) + sdk.share.link. Seeds the shared result-card.
import type { AppSpec } from "@superjam/shared";
import { resultCardComponent } from "./_share.ts";
import type { GateResult, Kit, KitContext } from "./types.ts";

const RE = /tier list|tierlist|\brank(?:ing|ed)?\b|\bs[- ]?tier\b|best to worst|order these|rate these|pick your top/i;
const match = (spec: AppSpec): boolean =>
  RE.test(`${spec.name} ${spec.description} ${spec.features.join(" ")}`);

const questions: Kit["questions"] = [
  { q: "What are people ranking?", options: ["A fixed list you provide", "They type their own items", "A themed set (foods, characters…)"] },
  { q: "How many tiers?", options: ["S / A / B / C (classic)", "S / A / B / C / D / F", "Top 3 only"] },
];

const itemsOf = (spec: AppSpec): string[] => {
  const feats = spec.features.map((f) => f.trim()).filter(Boolean);
  return feats.length >= 3 ? feats.slice(0, 8) : ["Pizza", "Tacos", "Sushi", "Burgers", "Ramen", "Tikka Masala"];
};

const plan = (spec: AppSpec): string => `# Build plan — ${spec.iconEmoji} ${spec.name} (tier list)

A working tap-to-rank starter is seeded (S/A/B/C + the share loop).

1. REWRITE \`ITEMS\` to the things being ranked for "${spec.name}". Tapping an item cycles
   it S → A → B → C → unranked. Show each item's current tier with its color.
2. Persist the ranking in \`sdk.storage.set("ranks", ranks)\` so it survives a reload.
3. End on the seeded \`<ResultCard>\` — the tiers with their items — and a "Share my
   ranking" button: \`shareResult(sdk, { text, data:{ ranks } })\`. \`readChallenge\` shows a
   friend's ranking when opened from a share ("@x ranked these — agree?").
4. Theme it (Toybox: .tj-card/.tj-choice/.tj-bar). Items to rank:
${itemsOf(spec).map((i) => `   - ${i}`).join("\n")}
5. Acceptance: tapping items assigns tiers, the result card shows the grouped ranking,
   and the share button produces a link.`;

const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const itemsLiteral = JSON.stringify(itemsOf(spec));
  const page = `"use client";

import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";
import { ResultCard, shareResult } from "@/components/result-card";

// ${title} — tap an item to cycle its tier, then share your ranking.
// TODO: replace ITEMS with the things to rank for "${title}".
const ITEMS: string[] = ${itemsLiteral};
const TIERS = ["S", "A", "B", "C"];
const TIER_COLOR = ["#FF4767", "#FFC23D", "#18C480", "#3E63F2"];

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [ranks, setRanks] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect(); sdkRef.current = s;
      const saved = await s.storage.get<Record<string, number>>("ranks");
      if (saved) setRanks(saved);
      setLoading(false);
    })();
  }, []);

  function cycle(item: string) {
    setRanks((r) => {
      const cur = r[item];
      const copy = { ...r };
      if (cur === undefined) copy[item] = 0;
      else if (cur + 1 >= TIERS.length) delete copy[item];
      else copy[item] = cur + 1;
      return copy;
    });
  }
  async function finish() {
    setDone(true);
    const s = sdkRef.current; if (s) await s.storage.set("ranks", ranks);
  }

  if (loading) return (<main className="tj-app tj-center"><div className="tj-card"><div className="tj-spin" /></div></main>);

  if (done) {
    const s = sdkRef.current;
    return (
      <main className="tj-app">
        <ResultCard emoji="${emoji}" title="My ranking" subtitle="${title}">
          {TIERS.map((t, ti) => {
            const inTier = ITEMS.filter((it) => ranks[it] === ti);
            if (inTier.length === 0) return null;
            return (
              <div key={t} className="tj-row" style={{ alignItems: "flex-start", marginTop: 8 }}>
                <span className="tj-badge" style={{ background: TIER_COLOR[ti], color: "#fff", minWidth: 28, justifyContent: "center" }}>{t}</span>
                <span style={{ fontWeight: 600 }}>{inTier.join(", ")}</span>
              </div>
            );
          })}
          <div className="tj-row" style={{ gap: 8, marginTop: 14 }}>
            <button className="tj-btn tj-btn-block" onClick={() => { if (s) shareResult(s, { text: "Here's my ${title} ranking — agree?", data: { ranks } }); }}>Share my ranking 🔗</button>
            <button className="tj-btn tj-btn-ghost" onClick={() => setDone(false)}>Edit</button>
          </div>
        </ResultCard>
      </main>
    );
  }

  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${emoji}</span>
          <div className="tj-htext"><h1 className="tj-title">${title}</h1><p className="tj-sub">Tap to rank: S → A → B → C → off</p></div>
        </div>
        <ul className="tj-list">
          {ITEMS.map((it) => {
            const t = ranks[it];
            return (
              <li key={it} style={{ display: "block" }}>
                <button className="tj-choice" style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => cycle(it)}>
                  <span>{it}</span>
                  <span className="tj-badge" style={{ background: t === undefined ? "var(--bg)" : TIER_COLOR[t], color: t === undefined ? "var(--muted)" : "#fff" }}>{t === undefined ? "—" : TIERS[t]}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button className="tj-btn tj-btn-block" style={{ marginTop: 12 }} onClick={finish}>See my ranking</button>
      </div>
    </main>
  );
}
`;
  return { "components/result-card.tsx": resultCardComponent(), "app/page.tsx": page };
};

const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  if (!/shareResult\(|\.share\.link\(/.test(page)) {
    missing.push("end on a shareable ranking — call shareResult(sdk, { text, data })");
  }
  if (!/\.storage\./.test(page)) {
    missing.push("persist the ranking with sdk.storage so it survives a reload");
  }
  return { ok: missing.length === 0, missing };
};

export const tierListKit: Kit = {
  id: "tier-list",
  title: "Tier list / ranking",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
