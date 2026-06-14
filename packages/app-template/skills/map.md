# SKILL map — plot places on a map (markers + route)

Use when the app puts **places** on screen: trip planners, "near me", store
locators, anything with coordinates. The sandbox ships a dependency-free
`MiniMap` (`src/lib/mini-map.tsx`) — an auto-fit SVG plot of stops as
day-coloured numbered markers joined by a dashed route line. Self-contained (no
tiles, no remote URL), so it bundles cleanly here.

```tsx
import { MiniMap, type MapStop } from "./lib/mini-map";

// stops in visit order; lat/lng required, day optional (colours the marker)
<MiniMap stops={stops} height={260} />
```

```ts
type MapStop = { name: string; lat: number; lng: number; day?: number };
```

## RULES
1. **Always validate coordinates** before plotting — anything from `sdk.ai.chat`
   can be junk. Keep only finite lat ∈ [-90,90], lng ∈ [-180,180], and ship a
   small local fallback so the map is never empty.
2. `>= 2` stops draws the route; the map auto-fits the bounding box. One stop just
   centres. Pass stops in the order you want the line drawn.
3. Pair the map with a list of the same stops (cards) — the map shows *where*,
   the list shows *what*.

## Deployed apps get a REAL interactive map
When the builder ships a jam with the `map` skill it seeds a richer
`components/trip-map.tsx` built on **MapLibre GL** (free, keyless Carto tiles —
pan/zoom, popups, the one allowed external fetch). The deployed app imports that
instead of `MiniMap`; the contract (`{ name, lat, lng, day }[]`) is the same, so
code written against `MiniMap` here maps straight over. See the builder's
`recipes/map.md` + `recipes/travel.md`.

The full worked app is `examples/japan-itinerary.tsx` (a curated 10-day Japan
guide → route on the map + per-stop cards + an ask-the-guide AI).
