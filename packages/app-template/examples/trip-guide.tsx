// Seed jam — Trip Guide (AI plans a trip → markers + route on a map, postcards,
// save + share, a community destinations leaderboard). Showcases sdk.ai.chat
// (structured JSON), the map skill, sdk.storage, sdk.share, and sdk.data.counter.
import { useEffect, useMemo, useRef, useState } from "react";
import { MiniMap, type MapStop } from "./lib/mini-map";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

type Stop = { name: string; lat: number; lng: number; day: number; category: string; blurb: string };
type Plan = { title: string; country: string; stops: Stop[] };

const CATS = ["city", "beach", "mountains", "countryside", "food", "culture"] as const;
const EMOJI: Record<string, string> = { city: "🏙️", beach: "🏖️", mountains: "⛰️", countryside: "🌻", food: "🍜", culture: "🏛️" };
const TINT: Record<string, string> = { city: "#DCE6FF", beach: "#FFF0D6", mountains: "#E2ECDD", countryside: "#FFF6CF", food: "#FFE0E6", culture: "#ECE2FF" };

const FALLBACK: Plan = {
  title: "Classic Japan", country: "Japan",
  stops: [
    { name: "Tokyo", lat: 35.68, lng: 139.69, day: 1, category: "city", blurb: "Neon streets and sushi counters." },
    { name: "Hakone", lat: 35.23, lng: 139.02, day: 2, category: "mountains", blurb: "Hot springs with Fuji views." },
    { name: "Kyoto", lat: 35.01, lng: 135.77, day: 3, category: "culture", blurb: "Temples, gardens, geisha lanes." },
    { name: "Osaka", lat: 34.69, lng: 135.5, day: 4, category: "food", blurb: "Street-food capital of Japan." },
  ],
};

function parsePlan(raw: string): Plan | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const rawStops = Array.isArray(o.stops) ? o.stops : [];
    const stops: Stop[] = rawStops.flatMap((s) => {
      const v = s as Record<string, unknown>;
      const lat = Number(v.lat), lng = Number(v.lng);
      const name = String(v.name ?? "").slice(0, 80);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
      const category = (CATS as readonly string[]).includes(String(v.category)) ? String(v.category) : "city";
      return [{ name, lat, lng, day: Number(v.day) || 1, category, blurb: String(v.blurb ?? "").slice(0, 140) }];
    });
    if (!stops.length) return null;
    return { title: String(o.title ?? "My Trip").slice(0, 60), country: String(o.country ?? "").slice(0, 40), stops };
  } catch {
    return null;
  }
}

// `launch` is an UNTRUSTED share payload — validate before rendering.
function planFromLaunch(launch: AppContext["launch"]): Plan | null {
  const p = (launch as { plan?: unknown } | null)?.plan;
  if (!p) return null;
  try { return parsePlan(JSON.stringify(p)); } catch { return null; }
}

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const [prompt, setPrompt] = useState("5 relaxing days in Japan — food and temples");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<{ key: string; value: number }[]>([]);
  const shared = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fromLink = planFromLaunch(ctx.launch);
    if (fromLink) { shared.current = true; setPlan(fromLink); }
    else void sdk.storage.get("trip").then((t) => t && setPlan(t as Plan)).catch(() => {});
    void sdk.data.counter("destinations").top(8).then(setBoard).catch(() => {});
  }, []);

  async function go() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    sfx.click();
    let next: Plan | null = null;
    try {
      const { text } = await sdk.ai.chat(
        [{ role: "user", content:
          `Plan a trip from this request: "${prompt}". Return ONLY JSON ` +
          `{"title":string,"country":string,"stops":[{"name":string,"lat":number,"lng":number,` +
          `"day":number,"category":"city"|"beach"|"mountains"|"countryside"|"food"|"culture",` +
          `"blurb":string}]}. 3-8 stops in visit order, real lat/lng, blurb <= 18 words.` }],
        { json: true },
      );
      next = parsePlan(text);
    } catch { /* offline → fallback */ }
    const final = next ?? FALLBACK;
    shared.current = false;
    setPlan(final);
    void sdk.storage.set("trip", final).catch(() => {});
    if (final.country) {
      void sdk.data.counter("destinations").increment(final.country, 1).catch(() => {});
      void sdk.data.counter("destinations").top(8).then(setBoard).catch(() => {});
    }
    setBusy(false);
  }

  async function share() {
    if (!plan) return;
    sfx.click();
    const { url } = await sdk.share.link({ data: { plan } });
    await navigator.clipboard?.writeText(url).catch(() => {});
    sdk.ui.toast("Trip link copied ✈️");
  }

  const stops: MapStop[] = useMemo(
    () => (plan?.stops ?? []).map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, day: s.day })),
    [plan],
  );

  return (
    <div className="tj-card">
      <h1 className="tj-title">🧭 Trip Guide</h1>
      <p className="tj-sub">Describe a trip — get a mapped, day-by-day plan.</p>
      <div className="tj-row">
        <input className="tj-input" value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="Where to?" style={{ flex: 1 }} />
        <button className="tj-btn" onClick={go} disabled={busy} style={{ background: "#4D7CFF" }}>
          {busy ? "Planning…" : "Plan"}
        </button>
      </div>

      {plan && (
        <>
          <h2 className="tj-title" style={{ fontSize: 20, marginTop: 14 }}>
            {plan.title}{shared.current ? " · shared with you" : ""}
          </h2>
          <MiniMap stops={stops} height={260} />
          <div className="tj-list" style={{ marginTop: 12 }}>
            {plan.stops.map((s, i) => (
              <div key={i} className="tj-row" style={{ alignItems: "center", gap: 12 }}>
                <div style={{ width: 52, height: 52, borderRadius: 12, display: "grid", placeItems: "center",
                  fontSize: 26, background: TINT[s.category] ?? "#EEE", flexShrink: 0 }}>
                  {EMOJI[s.category] ?? "📍"}
                </div>
                <div>
                  <strong>Day {s.day} · {s.name}</strong>
                  <div className="tj-muted" style={{ fontSize: 13 }}>{s.blurb}</div>
                </div>
              </div>
            ))}
          </div>
          <button className="tj-btn" onClick={share} style={{ background: "#2FD180", marginTop: 12 }}>
            Share trip ✈️
          </button>
        </>
      )}

      <h2 className="tj-title" style={{ fontSize: 18, marginTop: 18 }}>🌍 Top destinations</h2>
      {board.length ? (
        <ul className="tj-list">{board.map((r) => <li key={r.key}>{r.key} — {r.value} trips</li>)}</ul>
      ) : (
        <p className="tj-muted">Plan a trip to put a place on the board.</p>
      )}
    </div>
  );
}
