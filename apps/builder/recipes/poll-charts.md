# Recipe poll-charts — votes / polls / trackers, visualized (zero-backend)

A shared vote/poll/tracker where everyone's input rolls up into a live chart. Shared state in
`sdk.data.collection("votes")` (one per user); render counts as a bar chart. **Prefer inline
SVG / flex-div bars — no npm deps.** Capability: none.

## RULES
1. One vote per user — find the caller's existing doc (`docs.find(d => d.username === me)`),
   disable re-voting (or let them change it via `update`).
2. Compute the chart by reducing `collection.list()` docs client-side (your fields are under
   `doc.data`). Refresh after your own write.
3. Theme bars with candy colors (`#FF4D6D #FFC940 #2FD180 #4D7CFF`).

## Pattern — `app/page.tsx` (dep-free bars)

```tsx
"use client";
import SuperJam, { type SuperJamSdk, type Doc } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

const OPTIONS = ["Pizza", "Sushi", "Tacos", "Ramen"];

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [me, setMe] = useState("");
  const [votes, setVotes] = useState<Doc[]>([]);
  const mine = votes.find((v) => v.username === me);

  useEffect(() => { (async () => {
    const sdk = await SuperJam.connect(); sdkRef.current = sdk;
    setMe(sdk.app.context().user.username);
    setVotes((await sdk.data.collection("votes").list({ limit: 500 })).docs);
  })(); }, []);

  async function vote(choice: string) {
    const sdk = sdkRef.current; if (!sdk || mine) return;
    await sdk.data.collection("votes").insert({ choice });
    setVotes((await sdk.data.collection("votes").list({ limit: 500 })).docs);
  }

  const counts = OPTIONS.map((o) => ({ o, n: votes.filter((v) => v.data.choice === o).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1>🍱 Vote</h1>
      {OPTIONS.map((o) => (
        <button key={o} disabled={!!mine} onClick={() => vote(o)} style={{ marginRight: 8 }}>{o}</button>
      ))}
      <div style={{ marginTop: 16 }}>
        {counts.map((c, i) => (
          <div key={c.o} style={{ margin: "6px 0" }}>
            {c.o}
            <div style={{ height: 18, width: `${(c.n / max) * 100}%`,
              background: ["#FF4D6D", "#FFC940", "#2FD180", "#4D7CFF"][i % 4], borderRadius: 4 }} />
          </div>
        ))}
      </div>
      <p>{votes.length} votes · one per person</p>
    </main>
  );
}
```

## Variants
- **recharts upgrade** — add `"recharts"` to deps; `<ResponsiveContainer><BarChart>`; theme
  to candy hexes, never default blue.
- **Tracker over time** — bucket `doc.createdAt` by day into a line.
