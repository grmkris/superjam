// Seed jam — World Cup Picks (recharts over a shared collection; one vote/user).
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext, Doc } from "@superjam/sdk";

const TEAMS = ["Argentina", "France", "Brazil", "England"] as const;
const COLORS = ["#4D7CFF", "#FF4D6D", "#FFC940", "#2FD180"];

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const poll = sdk.data.collection("picks");
  const [votes, setVotes] = useState<Doc[]>([]);
  const mine = votes.find((v) => v.username === me);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void poll.list({ limit: 500 }).then((r) => setVotes(r.docs)); }, []);

  const data = useMemo(
    () => TEAMS.map((t) => ({ name: t, count: votes.filter((v) => v.data.team === t).length })),
    [votes],
  );

  async function vote(team: string) {
    if (mine) return;
    sfx.click();
    const { id, createdAt } = await poll.insert({ team });
    setVotes([
      { id, createdAt, userId: ctx.user.id, username: me, worldVerified: ctx.user.worldVerified, data: { team } },
      ...votes,
    ]);
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Who wins it all? 🏆</h1>
      <p className="tj-sub">{mine ? `You picked ${String(mine.data.team)}.` : "Tap your champion."}</p>
      <div className="tj-grid2">
        {TEAMS.map((t, i) => (
          <button key={t} className="tj-btn" disabled={!!mine}
            style={{ background: COLORS[i], outline: mine?.data.team === t ? "3px solid var(--text)" : undefined }}
            onClick={() => vote(t)}>{t}</button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} style={{ marginTop: 12 }}>
          <XAxis dataKey="name" stroke="#6B6478" fontSize={11} />
          <YAxis allowDecimals={false} stroke="#6B6478" width={24} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="tj-muted">{votes.length} votes · one per fan</p>
    </div>
  );
}
