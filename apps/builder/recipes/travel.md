# Recipe travel — AI trip guide on a map (skills: `map`, `art`; zero-backend)

The player describes a trip in plain words → `sdk.ai.chat` plans a day-by-day
itinerary as JSON → the stops render on the seeded **`<TripMap>`** (markers + route)
with a postcard image per stop, and the trip can be **saved** (`sdk.storage`) and
**shared** (`sdk.share.link`). A shared **destinations leaderboard**
(`sdk.data.counter`) shows where the community is wandering. **Platform primitives
only — no Neon, no API routes.** Manifest capability: `"ai"`.

Read `map.md` (the `<TripMap>` contract) and `art.md` (build-time `generate_image`)
alongside this.

## The AI plan contract

Ask for strict JSON with inline coordinates (no geocoder). Use a **fixed category
enum** so each stop maps to a baked postcard:

```
categories: "city" | "beach" | "mountains" | "countryside" | "food" | "culture"
```

```ts
type Stop = { name: string; lat: number; lng: number; day: number; time?: string; category: string; blurb: string };
type Plan = { title: string; country: string; stops: Stop[] };
```

```tsx
const { text } = await sdk.ai.chat(
  [{ role: "user", content:
    `Plan a trip from this request: "${prompt}". Return ONLY JSON ` +
    `{"title":string,"country":string,"stops":[{"name":string,"lat":number,"lng":number,` +
    `"day":number,"time":string,"category":"city"|"beach"|"mountains"|"countryside"|"food"|"culture",` +
    `"blurb":string}]}. 3-8 stops in visit order, real lat/lng, blurb <= 18 words.` }],
  { json: true },
);
```

## Postcards (build-time, `generate_image`)
Bake **one postcard per category** (6 images, well under budget) into `public/`,
referenced as `/postcard-<category>.png`. One reused style line (Toybox); always
"no text". Map each stop's `category` → its postcard, **emoji fallback** if a file
is missing (image gen can be unavailable — never ship a broken `<img>`).

```tsx
const EMOJI: Record<string, string> = { city:"🏙️", beach:"🏖️", mountains:"⛰️", countryside:"🌻", food:"🍜", culture:"🏛️" };
```

## RULES
1. `app/page.tsx` is `"use client"`. Defensively parse the AI plan (it can return
   junk): validate each stop, drop bad coords, and ship a small hard-coded fallback
   itinerary so the map is never empty. Show a loading state while planning
   (`ai.chat` is slow + ~25/user/day).
2. Use the seeded `<TripMap>` for the map — never add another map lib (see `map.md`).
3. On a successful plan, bump the leaderboard:
   `sdk.data.counter("destinations").increment(plan.country, 1)` → render `top(8)`.
4. Save the last plan to `sdk.storage.set("trip", plan)` and restore it on open.
5. Share with `sdk.share.link({ data: { plan } })`; on open, read
   `sdk.app.context().launch` and render that plan read-only (validate it first —
   `launch` is untrusted). Render all names/blurbs as plain React text.

## Pattern — `app/page.tsx`

```tsx
"use client";
import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { TripMap, type TripStop } from "@/components/trip-map";

type Stop = { name: string; lat: number; lng: number; day: number; time?: string; category: string; blurb: string };
type Plan = { title: string; country: string; stops: Stop[] };

const CATS = ["city", "beach", "mountains", "countryside", "food", "culture"] as const;
const EMOJI: Record<string, string> = { city: "🏙️", beach: "🏖️", mountains: "⛰️", countryside: "🌻", food: "🍜", culture: "🏛️" };
const FALLBACK: Plan = {
  title: "Classic Japan", country: "Japan",
  stops: [
    { name: "Tokyo", lat: 35.68, lng: 139.69, day: 1, category: "city", blurb: "Neon streets and sushi counters." },
    { name: "Hakone", lat: 35.23, lng: 139.02, day: 2, category: "mountains", blurb: "Hot springs with Fuji views." },
    { name: "Kyoto", lat: 35.01, lng: 135.77, day: 3, category: "culture", blurb: "Temples, gardens, geisha lanes." },
    { name: "Osaka", lat: 34.69, lng: 135.50, day: 4, category: "food", blurb: "Street food capital of Japan." },
  ],
};

function parsePlan(raw: string): Plan | null {
  try {
    const o = JSON.parse(raw) as any;
    const stops: Stop[] = (Array.isArray(o?.stops) ? o.stops : []).flatMap((s: any) => {
      const lat = Number(s?.lat), lng = Number(s?.lng), name = String(s?.name ?? "").slice(0, 80);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
      const category = CATS.includes(s?.category) ? s.category : "city";
      return [{ name, lat, lng, day: Number(s?.day) || 1, time: String(s?.time ?? "").slice(0, 24) || undefined,
                category, blurb: String(s?.blurb ?? "").slice(0, 140) }];
    });
    if (!stops.length) return null;
    return { title: String(o?.title ?? "My Trip").slice(0, 60), country: String(o?.country ?? "").slice(0, 40), stops };
  } catch { return null; }
}

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [me, setMe] = useState("");
  const [prompt, setPrompt] = useState("5 relaxing days in Japan — food and temples");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);

  useEffect(() => {
    (async () => {
      const sdk = await SuperJam.connect();
      sdkRef.current = sdk;
      const ctx = sdk.app.context();
      setMe(ctx.user.username);
      // shared trip → read-only; else restore the user's saved trip
      const shared = parsePlanLoose(ctx.launch);
      if (shared) setPlan(shared);
      else setPlan((await sdk.storage.get("trip").catch(() => null)) as Plan ?? null);
      setBoard(await sdk.data.counter("destinations").top(8).catch(() => []));
    })();
  }, []);

  async function go() {
    const sdk = sdkRef.current;
    if (!sdk || busy || !prompt.trim()) return;
    setBusy(true);
    let next: Plan | null = null;
    try {
      const { text } = await sdk.ai.chat(
        [{ role: "user", content:
          `Plan a trip from this request: "${prompt}". Return ONLY JSON ` +
          `{"title":string,"country":string,"stops":[{"name":string,"lat":number,"lng":number,` +
          `"day":number,"time":string,"category":"city"|"beach"|"mountains"|"countryside"|"food"|"culture",` +
          `"blurb":string}]}. 3-8 stops in visit order, real lat/lng, blurb <= 18 words.` }],
        { json: true },
      );
      next = parsePlan(text);
    } catch { /* offline → fallback */ }
    const final = next ?? FALLBACK;
    setPlan(final);
    await sdk.storage.set("trip", final).catch(() => {});
    if (final.country) {
      await sdk.data.counter("destinations").increment(final.country, 1).catch(() => {});
      setBoard(await sdk.data.counter("destinations").top(8).catch(() => []));
    }
    setBusy(false);
  }

  async function share() {
    const sdk = sdkRef.current;
    if (!sdk || !plan) return;
    const { url } = await sdk.share.link({ data: { plan } });
    sdk.ui.toast(`Trip link copied`);
    await navigator.clipboard?.writeText(url).catch(() => {});
  }

  const stops: TripStop[] = useMemo(
    () => (plan?.stops ?? []).map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, day: s.day, blurb: s.blurb })),
    [plan],
  );

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ margin: "8px 0" }}>🧭 Trip Guide</h1>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Where to?"
          style={{ flex: 1, padding: 10, borderRadius: 10, border: "2px solid #221A33" }} />
        <button onClick={go} disabled={busy}
          style={{ padding: "10px 16px", borderRadius: 10, background: "#4D7CFF", color: "#fff", fontWeight: 700 }}>
          {busy ? "Planning…" : "Plan"}
        </button>
      </div>

      {plan && (
        <>
          <h2 style={{ marginTop: 16 }}>{plan.title}</h2>
          <TripMap stops={stops} height={320} />
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {plan.stops.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: 10, borderRadius: 12, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,.08)" }}>
                <Postcard category={s.category} />
                <div>
                  <strong>Day {s.day} · {s.name}</strong>
                  <div style={{ fontSize: 13, color: "#6B6478" }}>{s.blurb}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={share} style={{ marginTop: 12, padding: "8px 14px", borderRadius: 10, background: "#2FD180", color: "#fff", fontWeight: 700 }}>
            Share trip
          </button>
        </>
      )}

      <h2 style={{ marginTop: 20 }}>🌍 Top destinations</h2>
      <ul>{board.map((r) => <li key={r.key}>{r.key} — {r.value} trips</li>)}</ul>
    </main>
  );
}

function Postcard({ category }: { category: string }) {
  const [ok, setOk] = useState(true);
  if (ok) return (
    <img src={`/postcard-${category}.png`} alt="" width={64} height={64} onError={() => setOk(false)}
      style={{ borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
  );
  return <div style={{ width: 64, height: 64, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 28, background: "#FFE9C7", flexShrink: 0 }}>{EMOJI[category] ?? "📍"}</div>;
}

// `launch` is untrusted — validate before rendering a shared plan.
function parsePlanLoose(launch: unknown): Plan | null {
  const p = (launch as any)?.plan;
  if (!p) return null;
  try { return parsePlan(JSON.stringify(p)); } catch { return null; }
}
```

## Variants
- **No money** by default; add a `"payments"` capability + `sdk.payments.payUSDC`
  to tip a local guide or unlock a premium long-form itinerary.
- **Community trips** — publish a plan to `sdk.data.collection("trips")` and let
  others open shared itineraries from a gallery.
- **Themed postcards** — swap the category enum to the app's vibe (e.g. `surf`,
  `ski`, `nightlife`) and regenerate the postcard set to match.
