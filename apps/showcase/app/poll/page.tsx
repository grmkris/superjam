"use client";

// Proof-of-Human Poll — a live poll where only World-verified humans can vote
// (one human, one vote). Gates on ctx.user.worldVerified (true for everyone in
// DEMO_MODE, so it works live) and enforces one vote/user via a shared collection.
import type { AppContext, Doc, SuperJamSdk } from "../../lib/superjam-sdk";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis } from "recharts";
import { JamPage } from "../../lib/jam";

const QUESTION = "Should an AI agent need a verified human backer to move money?";
const OPTIONS = ["Yes — always", "Only above $100", "No, code is law"] as const;
const COLORS = ["#2FD180", "#4D7CFF", "#FF4D6D"];

function PollApp({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const verified = ctx.user.worldVerified;
  const votes = sdk.data.collection("votes");
  const [docs, setDocs] = useState<Doc[]>([]);
  const mine = docs.find((d) => d.username === me);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void votes.list({ limit: 1000 }).then((r) => setDocs(r.docs)); }, []);

  const data = useMemo(
    () => OPTIONS.map((o) => ({ name: o, count: docs.filter((d) => d.data.option === o).length })),
    [docs]
  );
  const total = docs.length;

  async function vote(option: string) {
    if (mine || !verified) return;
    const { id, createdAt } = await votes.insert({ option });
    setDocs([
      { id, createdAt, userId: ctx.user.id, username: me, worldVerified: verified, data: { option } },
      ...docs,
    ]);
    sdk.ui.toast("Vote counted ✓");
  }

  return (
    <div className="tj-card">
      <span className="tj-badge">🌍 1 human · 1 vote</span>
      <h1 className="tj-title" style={{ marginTop: 10 }}>{QUESTION}</h1>
      <p className="tj-sub">
        {verified ? "You're a verified human — your vote counts once." : "Only World-verified humans can vote here."}
      </p>

      <div style={{ display: "grid", gap: 8 }}>
        {OPTIONS.map((o, i) => {
          const picked = mine?.data.option === o;
          return (
            <button
              key={o}
              className="tj-btn"
              disabled={!!mine || !verified}
              style={{ background: COLORS[i], outline: picked ? "3px solid var(--text)" : undefined }}
              onClick={() => vote(o)}
            >
              {o}{picked ? " ✓" : ""}
            </button>
          );
        })}
      </div>

      {total > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 20 }}>
            <XAxis dataKey="name" stroke="#6B6478" fontSize={10} interval={0} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              <LabelList dataKey="count" position="top" fontSize={12} fontWeight={700} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      <p className="tj-muted" style={{ fontSize: 13, marginTop: 6 }}>
        {total} verified {total === 1 ? "human has" : "humans have"} voted · no bots, no brigading
      </p>
    </div>
  );
}

export default function Page() {
  return <JamPage render={(sdk, ctx) => <PollApp sdk={sdk} ctx={ctx} />} />;
}
