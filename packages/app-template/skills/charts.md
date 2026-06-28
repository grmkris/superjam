# SKILL charts — visualize shared data with recharts

Dep: `recharts` (installed). Use it whenever the app collects numbers across
users — polls, trackers, splitters, vote walls. A chart over `sdk.data` is what
makes these apps feel real.

## RULES
1. Charts must live inside a sized container — recharts needs dimensions:
   `<ResponsiveContainer width="100%" height={240}>` inside a `tj-card`.
2. Compute chart data by reducing `sdk.data.collection(...).list(...)` docs
   client-side — YOUR fields are under `doc.data` (read `v.data.choice`).
   Refresh after your own writes.
3. Theme the chart to theme.css (the dark Stage): bars/lines `var(--accent)` → pass the
   hex `#FF4767` (or a sibling `#F5B53C`/`#18C480`/`#5B7BFF`), grid/axis/text the light
   muted `#9B97AD` (axes + labels must read on the DARK stage), grid lines at low opacity,
   never default recharts blue or a dark axis (it vanishes on the dark page).
4. Keep to Bar/Line/Pie — no exotic chart types.

## The pattern — poll with a live bar chart

```tsx
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext, Doc } from "@superjam/sdk";

const OPTIONS = ["Pizza", "Sushi", "Tacos", "Ramen"];

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const [votes, setVotes] = useState<Doc[]>([]);
  const poll = sdk.data.collection("votes");
  const mine = votes.find((v) => v.username === ctx.user.username);

  useEffect(() => { void poll.list({ limit: 500 }).then((r) => setVotes(r.docs)); }, []);

  const data = useMemo(
    () => OPTIONS.map((o) => ({ name: o, count: votes.filter((v) => v.data.choice === o).length })),
    [votes],
  );

  async function vote(choice: string) {
    if (mine) return;
    sfx.click();
    const { id, createdAt } = await poll.insert({ choice });
    setVotes([{ id, createdAt, userId: ctx.user.id, username: ctx.user.username,
                worldVerified: ctx.user.worldVerified, data: { choice } }, ...votes]);
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Lunch vote 🍱</h1>
      <div className="tj-row" style={{ flexWrap: "wrap" }}>
        {OPTIONS.map((o) => (
          <button key={o} className="tj-btn" disabled={!!mine}
            style={mine?.data.choice === o ? { outline: "3px solid #221A33" } : undefined}
            onClick={() => vote(o)}>{o}</button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <XAxis dataKey="name" stroke="#6B6478" />
          <YAxis allowDecimals={false} stroke="#6B6478" />
          <Bar dataKey="count" fill="#FF4D6D" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="tj-muted">{votes.length} votes · one per person</p>
    </div>
  );
}
```

Variants: Line chart over time (bucket `createdAt` by day), Pie for shares
(expense splitter), horizontal bars for leaderboard-style rankings.

## Runtime user CSVs (papaparse — also a curated dep)
Let the user drop a spreadsheet and chart it client-side:
```tsx
import Papa from "papaparse";   // available when this skill is loaded
const f = e.target.files?.[0];
if (f) Papa.parse(f, { header: true, dynamicTyping: true, complete: (res) => setRows(res.data) });
```
Reduce `res.data` into recharts series. (Build-time user files live at
`./assets/data/*.csv` — `fetch("./assets/data/x.csv").then(r=>r.text())` then
`Papa.parse(text,{header:true})`.) Never load a remote URL.
