# Recipe travel — a rich, curated place itinerary (skills: `map`, `art`)

The flagship pattern: **YOU (the build agent) author a complete, gorgeous travel
guide for a real destination** — a finished, content-rich itinerary, not an empty
"planner". The richness is BAKED at build time from your own knowledge: a real
day-by-day route, the actual stops on an interactive map, a beautiful generated
photo per place, and food / transit / tips. Optionally a light "ask the guide" AI.
**Platform primitives only — no Neon, no API routes.** Manifest capability: `"ai"`
only if you add the ask-the-guide helper.

Read `map.md` (the seeded `<TripMap>` contract) alongside this. The generator has
already added `maplibre-gl` and seeded `components/trip-map.tsx`.

## The mindset — curate, don't defer
This is a magazine-quality guide the user reads and explores. **Write the itinerary
yourself, inline, as real data.** Use your knowledge of the destination: real place
names, real coordinates, the sensible visit order, what's special about each stop,
specific dishes + where to eat them, how to travel between cities, and timing/budget/
seasonal tips. Do NOT leave the content to runtime — there is no "type a prompt"
flow here. The user opens the app and a stunning, specific trip is already there.

## 1. Author the itinerary (inline typed data)
```ts
type Stop = {
  day: string;        // "Day 1–2", "Day 5"
  name: string;       // "Kyoto"
  lat: number; lng: number;   // REAL coordinates
  category: string;   // city | mountains | coast | culture | food | nature
  blurb: string;      // 2–3 vivid sentences — why this place, what to feel
  highlights: string[];   // 3–5 must-do sights/experiences
  food: string[];         // 2+ specific dishes + a named spot each
  transit: string;        // how you ARRIVE here ("2h12 shinkansen from Tokyo, JR Pass covers it")
  tip: string;            // one practical/seasonal/timing/budget tip
  photo: string;          // "/photo-kyoto.png" (baked below; emoji fallback)
};
const TRIP = { title: "...", days: 10, stops: [ /* the full curated route */ ] };
```
Order the stops as the real route so the map line reads as the actual journey.

## 2. Bake the photos (`generate_image`, budget 8)
Generate a **hero** + **one real-scene photo per stop**, within the 8-image budget
(so ≤7 stops get a photo + 1 hero). Make each prompt a specific, recognizable scene
of THAT place, one consistent photographic style line reused across all of them, and
always "no text". Write to `public/photo-<slug>.png`, reference as `/photo-<slug>.png`.
**Every `<img>` must degrade to an emoji/gradient tile** (image gen can be
unavailable) — never a broken image. Generate the images FIRST, then write the UI.

## 3. Render it read-first and polished (CSS only — no extra deps)
- **Hero**: full-width hero image + the trip title + a "trip at a glance" line
  (`{days} days · {stops.length} stops · {first} → {last}`).
- **Map**: `<TripMap stops={stops} height={320} />` — the route across all stops
  (see `map.md`; map tiles are the one allowed external fetch).
- **Itinerary**: one rich card per stop — the photo, day badge, name, blurb,
  highlights, food picks, a "Getting here" transit line, and the tip. A sticky
  day-nav or numbered rail that scrolls to each stop is a nice touch.
- Polish with **plain CSS only**: smooth expand/collapse (max-height transition),
  image hover zoom (`transform: scale`), fade-in on scroll, sticky header. Do NOT
  add motion/react or any new dependency — it isn't installed.
- Toybox-friendly, mobile-first, one screen. Render all text as plain React text.

## 4. Optional — "ask the guide" (capability `"ai"`)
A small input that answers questions about THIS trip, grounded in the baked data:
```tsx
const ctxText = TRIP.stops.map(s => `${s.name}: ${s.blurb} Food: ${s.food.join("; ")}. ${s.tip}`).join("\n");
const { text } = await sdk.ai.chat([
  { role: "system", content: `You are a friendly guide for this exact itinerary:\n${ctxText}\nAnswer only about this trip, briefly.` },
  { role: "user", content: question },
]);
```
Show a loading state, parse defensively, and fall back to a canned "open inside
SuperJam" / "couldn't reach the guide" message — never block the page on it.

## 5. Nice-to-haves
- **Bookmark stops** to `sdk.storage` ("my favorites" on the day rail).
- **Share** the guide with `sdk.share.link()`.

## RULES
1. `app/page.tsx` is `"use client"`. The trip data is baked; first render is instant
   and complete WITHOUT any network/AI call.
2. Real coordinates + real content — this is a specific place, get it right.
3. Photos via `generate_image` only (≤8), each with an emoji/gradient fallback.
4. Use the seeded `<TripMap>`; never add another map lib (see `map.md`).
5. `ai.chat` (if used) is enhancement only — defensive, with a fallback.

---

## Variant — runtime planner (only if the spec is a generic "plan any trip" tool)
If the spec really is an open-ended planner (the user types any destination), have
`sdk.ai.chat` return the itinerary as JSON and validate it before plotting:
```tsx
const { text } = await sdk.ai.chat(
  [{ role: "user", content:
    `Plan a trip from this request: "${prompt}". Return ONLY JSON ` +
    `{"title":string,"country":string,"stops":[{"name":string,"lat":number,"lng":number,"day":number,"category":string,"blurb":string}]}. ` +
    `3-8 stops in visit order, real lat/lng.` }],
  { json: true },
);
```
Validate each stop (finite lat ∈ [-90,90], lng ∈ [-180,180]), drop bad ones, ship a
hard-coded fallback itinerary, and feed the result to `<TripMap>`. Prefer the
curated pattern above for any place-specific guide.
