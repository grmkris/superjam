// travel — a use-case kit for trip guides / day-by-day itineraries. The build is a
// real, content-rich travel guide: a curated TripStop[] of real geocoded places
// plotted on the seeded <TripMap>, with a day-by-day list below. It declares
// skills: ["map"] so the harness seeds components/trip-map.tsx BEFORE generateApp
// (the kit imports it, never rewrites it — see recipes/map.md + recipes/travel.md).
//
// SDK CONTRACT — same self-connect shape as tap-arcade (RECONCILED against what
// compiles+runs, NOT SDK.md's prop signature): a "use client" default-export page
// that obtains the sdk itself —
//   import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
//   const sdk = await SuperJam.connect();   // inside a useEffect
//   const ctx = sdk.app.context();          // synchronous, after connect
// The trip data is BAKED inline so first render is instant and complete with no
// network/AI call; sdk.ai.chat (optional) only ENRICHES, defensively parsed.
import type { AppSpec } from "@superjam/shared";
import type { GateResult, Kit, KitContext } from "./types.ts";

// Mirrors selectRecipes' keyword heuristic: the name/description/features read
// like a trip guide / itinerary / vacation plan / road-trip / things-to-do guide.
const TRAVEL_RE =
  /trip|travel|itinerary|vacation|holiday|tour|destination|guide to|things to do|day-?by-?day|road ?trip/i;

const match = (spec: AppSpec): boolean => {
  if (spec.skills?.some((s) => s === "map")) return true;
  const hay = `${spec.name} ${spec.description} ${spec.features.join(" ")}`;
  return TRAVEL_RE.test(hay);
};

const questions: Kit["questions"] = [
  {
    q: "Where does this trip go?",
    options: ["One city + day trips", "A multi-city region", "A road trip route", "A whole country"],
  },
  {
    q: "How long is the trip?",
    options: ["A weekend (2-3 days)", "About a week", "Two weeks or more"],
  },
  {
    q: "What's the traveler's vibe?",
    options: ["Foodie", "Adventure / outdoors", "Relax / slow", "Culture / history"],
  },
];

const plan = (spec: AppSpec): string => {
  const emoji = spec.iconEmoji;
  const feats = spec.features.length
    ? spec.features.map((f) => `   - ${f}`).join("\n")
    : "   - (no extra features declared — keep it a tight, beautiful guide)";
  return `# Build plan — ${emoji} ${spec.name} (travel itinerary / trip guide)

1. Connect on mount: \`const sdk = await SuperJam.connect()\` inside a useEffect,
   then \`sdk.app.context()\` for the traveler. Show a loading state until ready.
2. BAKE the itinerary inline as a \`TripStop[]\` of REAL places for the
   destination — \`{ name, lat, lng, day, blurb }\` — in visit order. Use your own
   knowledge: real coordinates, the sensible route, one vivid blurb per stop. Ship
   4-6 stops minimum so the map is NEVER empty. First render must be complete with
   NO network/AI call.
3. Validate coordinates before plotting (AI/edited data can be junk): keep only
   finite \`lat ∈ [-90,90]\` / \`lng ∈ [-180,180]\`; drop bad rows; never let the
   list go empty (fall back to the baked stops).
4. Render the map: \`import { TripMap, type TripStop } from "@/components/trip-map"\`
   then \`<TripMap stops={stops} height={340} />\`. Do NOT add another map library —
   the seeded <TripMap> is the whole map layer (see recipes/map.md).
5. Render a day-by-day list BELOW the map: group/sort stops by \`day\`, each as a
   card with the day badge, place name, and blurb.
6. Optional persistence: track a "visited" set with \`sdk.storage\`
   (\`get<string[]>("visited")\` / \`set\`) so the traveler can tick off stops.
7. Optional enrichment: a "regenerate plan" button that calls \`sdk.ai.chat(…,
   { json: true })\` for a fresh route, then RE-VALIDATES every coordinate before
   feeding it to <TripMap>. Enhancement only — show a loading state, fall back to
   the baked stops, never block first render.
8. Wire the spec's specifics:
${feats}
9. Acceptance: the map shows the real route on first load (no empty map), the
   day-by-day list reads as the journey, and bad coordinates never crash the page.`;
};

// A near-complete, TYPE-CORRECT starter. It compiles as-is (the gaps are content /
// styling, not type holes) and follows the self-connect pattern + imports the
// seeded <TripMap>. The model fills the `// TODO:` gaps.
const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const page = `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { TripMap, type TripStop } from "@/components/trip-map";
import { useEffect, useMemo, useState } from "react";

// ${title} — a travel itinerary. The route is BAKED inline as real geocoded
// places (first render is instant + complete); <TripMap> plots it and a
// day-by-day list reads as the journey. Persists a "visited" set in sdk.storage.

// TODO: swap these for the SPEC's real destination + stops. Keep them REAL places
// with REAL coordinates, in visit order, with a day + a one-line blurb each.
const FALLBACK_STOPS: TripStop[] = [
  { name: "Alfama", lat: 38.7118, lng: -9.1296, day: 1, blurb: "Lisbon's oldest quarter — tiled lanes, fado, miradouros." },
  { name: "Belém", lat: 38.6979, lng: -9.2065, day: 1, blurb: "The Tower, the Monastery, and a warm pastel de nata." },
  { name: "Sintra", lat: 38.7979, lng: -9.3906, day: 2, blurb: "Palaces in the hills — Pena, Quinta da Regaleira." },
  { name: "Cascais", lat: 38.6970, lng: -9.4215, day: 2, blurb: "Seaside town for sunset and grilled fish." },
  { name: "Évora", lat: 38.5667, lng: -7.9000, day: 3, blurb: "Roman temple, bone chapel, Alentejo wine country." },
  { name: "Óbidos", lat: 39.3606, lng: -9.1572, day: 3, blurb: "Whitewashed walled village; ginjinha in a chocolate cup." },
];

// Keep only finite, in-range coordinates — AI/edited data can be junk.
function validStops(raw: TripStop[]): TripStop[] {
  return raw.filter(
    (s) =>
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      Math.abs(s.lat) <= 90 &&
      Math.abs(s.lng) <= 180 &&
      !!s.name,
  );
}

export default function Page() {
  const [sdk, setSdk] = useState<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [stops, setStops] = useState<TripStop[]>(FALLBACK_STOPS);
  const [visited, setVisited] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect once, then load any saved "visited" set (self-connect pattern).
  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect();
      setSdk(s);
      setCtx(s.app.context());
      const saved = (await s.storage.get<string[]>("visited")) ?? [];
      setVisited(Array.isArray(saved) ? saved : []);
      setLoading(false);
    })();
  }, []);

  // Validate before plotting; never let the map go empty.
  const safeStops = useMemo(() => {
    const ok = validStops(stops);
    return ok.length ? ok : FALLBACK_STOPS;
  }, [stops]);

  // Group the stops by day so the list reads as the day-by-day journey.
  const byDay = useMemo(() => {
    const m = new Map<number, TripStop[]>();
    for (const s of safeStops) {
      const d = s.day ?? 0;
      (m.get(d) ?? m.set(d, []).get(d)!).push(s);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [safeStops]);

  async function toggleVisited(name: string) {
    if (!sdk) return;
    const next = visited.includes(name) ? visited.filter((n) => n !== name) : [...visited, name];
    setVisited(next);
    await sdk.storage.set("visited", next);
  }

  const days = byDay.length ? byDay[byDay.length - 1][0] : 0;

  if (loading) {
    return (
      <main className="tj-app tj-center">
        <div className="tj-card">
          <div className="tj-spin" />
          <p className="tj-sub">Planning ${title}…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${emoji}</span>
          <div className="tj-htext">
            <h1 className="tj-title">${title}</h1>
            <p className="tj-sub">
              {days} {days === 1 ? "day" : "days"} · {safeStops.length} stops · {safeStops[0]?.name} → {safeStops[safeStops.length - 1]?.name}
            </p>
          </div>
        </div>
        <TripMap stops={safeStops} height={340} />
        {/* TODO: add a "regenerate plan" button that calls sdk.ai.chat(…, { json: true })
            for a fresh route, RE-VALIDATES every coord with validStops(), then
            setStops(...). Enhancement only — fall back to FALLBACK_STOPS on junk. */}
      </div>

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>Day by day 🗺️</h2>
        {byDay.map(([day, group]) => (
          <div key={day}>
            <span className="tj-badge">Day {day || 1}</span>
            <ul className="tj-list">
              {group.map((s) => (
                <li key={s.name} onClick={() => toggleVisited(s.name)} style={{ cursor: "pointer" }}>
                  {/* TODO: style the day cards — a check/medal when visited, the blurb
                      as a secondary line, maybe a "getting here" / food line per stop. */}
                  <b style={visited.includes(s.name) ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                    {s.name}
                  </b>{" "}
                  {visited.includes(s.name) && <span>✅</span>}
                  <div className="tj-muted">{s.blurb}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {byDay.length === 0 && <div className="tj-empty">No stops yet.</div>}
      </div>
    </main>
  );
}
`;
  return { "app/page.tsx": page };
};

// Kit gate — runs ALONGSIDE the generic gate (which already enforces @superjam/sdk
// usage, "use client", interactivity, and not-a-stub). Here we add the travel-core
// probes: it must IMPORT + RENDER the seeded <TripMap> and actually build stops.
// Match imports / JSX / method-shape, NOT an `sdk.` prefix or leftover // TODO.
const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  if (!/trip-map/.test(page)) {
    missing.push('import the seeded <TripMap>: import { TripMap, type TripStop } from "@/components/trip-map"');
  }
  if (!/<TripMap\b/.test(page)) {
    missing.push("render <TripMap stops={...} height={...} /> with the itinerary stops");
  }
  if (!/TripStop|stops\s*=|lat:/.test(page)) {
    missing.push("build a TripStop[] of real places (name + lat/lng + day + blurb) to feed <TripMap>");
  }
  // NOTE: no share-loop requirement — a trip guide is a showcase, not a "beat my
  // score" loop; forcing share + the map was too much for the cheap model in 4 rounds.
  return { ok: missing.length === 0, missing };
};

export const travelKit: Kit = {
  id: "travel",
  title: "Travel itinerary / trip guide",
  skills: ["map"],
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
