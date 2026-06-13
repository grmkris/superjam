# Recipe realtime — live-updating boards / light multiplayer (zero-backend)

Re-render shared state as it changes — a leaderboard ticking up while scores land, a live poll,
a tap-race. Built on the same `sdk.data` primitives; the "realtime" part is **how often you
refresh**. Capability: none.

## The rule: poll first, subscribe if available
- **v1 — polling (always works):** re-`list()` / re-`top()` on a `setInterval` (≥3–5s; never
  sub-second). Clean up the interval on unmount. This needs zero extra infra and is the safe
  default.
- **If the SDK exposes `sdk.data.collection(name).subscribe(cb)`** (a push stretch), prefer it
  and fall back to polling if it throws. Don't assume it exists — guard with a `typeof` check.

## Pattern — live leaderboard
```tsx
"use client";
import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    (async () => {
      const sdk = await SuperJam.connect(); sdkRef.current = sdk;
      const refresh = async () => setBoard(await sdk.data.counter("scores").top(10));
      await refresh();
      timer = setInterval(refresh, 4000);   // live without infra
    })();
    return () => clearInterval(timer);
  }, []);

  return <main style={{ padding: 24 }}>
    <h1>🏁 Live board</h1>
    <ul>{board.map((r) => <li key={r.key}>@{r.key} — {r.value}</li>)}</ul>
  </main>;
}
```

## Variants
- **Tap-race** — everyone taps; each tap `counter("taps").increment(me, 1)`; the polled board
  shows the race live.
- **Shared moves** (light multiplayer) — write moves to `data.collection("moves")`, poll to
  see opponents'.
