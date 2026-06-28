# Recipe map — interactive maps with the seeded `<TripMap>` (skill: `map`)

When the spec carries the **`map`** skill the generator has already added the
`maplibre-gl` dependency and seeded a ready, correct client component at
**`components/trip-map.tsx`**. You **import and use it** — do NOT rewrite it, and
do NOT add another map library. It renders a free, keyless [MapLibre GL] basemap
(Carto Voyager tiles) with day-coloured numbered markers, popups, a dashed route
line through the stops, and auto-fit to the itinerary.

> **The one allowed external fetch.** SuperJam jams are otherwise self-contained
> (no CDN images/fonts). The map basemap tiles are the deliberate exception and
> live entirely inside the seeded `<TripMap>` — the host CSP permits them. Your
> own code still fetches nothing external.

## The component contract

```tsx
import { TripMap, type TripStop } from "@/components/trip-map";

// stops in visit order; lat/lng required, day/blurb optional
<TripMap stops={stops} height={340} />
```

```ts
type TripStop = { name: string; lat: number; lng: number; day?: number; blurb?: string };
```

- Markers are numbered + coloured by `day` (falls back to index order).
- `>= 2` stops draws the route line; the map auto-`fitBounds` to all stops.
- One stop centres + zooms in. Zero valid stops shows the world.

## Feeding it stops

Build `TripStop[]` from wherever your data lives — an `sdk.ai.chat` plan, a
`sdk.data.collection`, hard-coded picks. **Always coerce + validate coordinates**
(AI output can be junk): keep only finite numbers in lat ∈ [-90,90],
lng ∈ [-180,180], and ship a small local fallback so the map is never empty.

```tsx
function toStops(raw: unknown): TripStop[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    const lat = Number((s as any)?.lat), lng = Number((s as any)?.lng);
    const name = String((s as any)?.name ?? "").slice(0, 80);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    return [{ name, lat, lng, day: Number((s as any)?.day) || undefined,
              blurb: String((s as any)?.blurb ?? "").slice(0, 140) || undefined }];
  });
}
```

## RULES
1. `app/page.tsx` is `"use client"`. Pass `<TripMap>` a stable array (memoize, or
   set it in state) — it re-inits the map when `stops` changes.
2. Give the map room: a sized parent (the component fills width and uses its
   `height` prop). Put it in a card next to the list of stops.
3. NEVER trust raw AI coordinates — validate as above; provide a fallback itinerary.
4. Don't fetch tiles/styles yourself and don't add `react-map-gl`/Leaflet — the
   seeded component is the whole map layer.

See `travel.md` for the full AI-plans-a-trip archetype that uses this.
