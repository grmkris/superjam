// Seed jam — 10 Days in Japan. A curated, content-rich itinerary the build agent
// authors at build time (NOT a planner): real stops + route on the map, a photo
// per stop, food/transit/tips, and an "ask the guide" AI. In the deployed app the
// photos are baked via generate_image; here in the sandbox we use emoji/gradient
// tiles. Showcases the `map` skill + sdk.ai.chat + sdk.storage.
import { useEffect, useMemo, useState } from "react";
import { MiniMap, type MapStop } from "./lib/mini-map";
import { sfx } from "./lib/sfx";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

type Stop = {
  day: string;
  name: string;
  lat: number;
  lng: number;
  emoji: string;
  blurb: string;
  highlights: string[];
  food: string[];
  transit: string;
  tip: string;
};

const TRIP: { title: string; days: number; stops: Stop[] } = {
  title: "10 Days in Japan",
  days: 10,
  stops: [
    {
      day: "Day 1–2", name: "Tokyo", lat: 35.68, lng: 139.69, emoji: "🏙️",
      blurb: "Begin in the electric capital — neon canyons in Shinjuku, the calm of Senso-ji at dawn, and the world's best convenience-store snacks.",
      highlights: ["Senso-ji temple, Asakusa", "Shibuya Crossing + Shibuya Sky", "teamLab digital art", "Shinjuku izakaya alleys"],
      food: ["Sushi at Toyosu market", "Ramen in Shinjuku's Omoide Yokocho", "Tonkatsu in Ueno"],
      transit: "Arrive Narita/Haneda; Tokyo is your base for two nights.",
      tip: "Grab a Suica IC card at the airport — tap onto every train and konbini.",
    },
    {
      day: "Day 3", name: "Hakone", lat: 35.23, lng: 139.02, emoji: "⛰️",
      blurb: "Escape to the mountains for onsen and, on a clear day, a perfect Mt Fuji. Sleep in a ryokan and soak under the stars.",
      highlights: ["Lake Ashi pirate cruise", "Hakone Open-Air Museum", "Owakudani black eggs", "a riverside ryokan onsen"],
      food: ["Kaiseki dinner at your ryokan", "Black eggs boiled in volcanic springs"],
      transit: "~1h25 by Odakyu Romancecar from Shinjuku; ride the Hakone loop.",
      tip: "Book the ryokan with a private onsen if you have tattoos.",
    },
    {
      day: "Day 4–5", name: "Kyoto", lat: 35.01, lng: 135.77, emoji: "🏯",
      blurb: "The old capital: a thousand shrines, mossy gardens, and lantern-lit Gion lanes where geiko still hurry to appointments.",
      highlights: ["Fushimi Inari's torii tunnels at sunrise", "Arashiyama bamboo grove", "Kinkaku-ji golden pavilion", "Gion at dusk"],
      food: ["Kaiseki near Pontocho", "Nishiki Market street snacks", "matcha + warabimochi"],
      transit: "~2h12 shinkansen Tokyo→Kyoto (JR Pass covers it).",
      tip: "Do Fushimi Inari before 8am — empty paths and soft light.",
    },
    {
      day: "Day 6", name: "Nara", lat: 34.69, lng: 135.83, emoji: "🦌",
      blurb: "A breezy day trip to bowing deer, a giant bronze Buddha, and Japan's most atmospheric lantern-lined shrine.",
      highlights: ["Todai-ji Great Buddha", "free-roaming deer in Nara Park", "Kasuga Taisha lanterns"],
      food: ["Kakinoha-zushi (persimmon-leaf sushi)", "mochi pounded at Nakatanidou"],
      transit: "~45 min by rapid train from Kyoto or Osaka.",
      tip: "Buy deer crackers (shika senbei) — and bow back, they bow first.",
    },
    {
      day: "Day 7", name: "Osaka", lat: 34.69, lng: 135.50, emoji: "🍜",
      blurb: "Japan's kitchen. Loud, friendly, and built for eating — Dotonbori's neon reflected in the canal as you graze your way down the street.",
      highlights: ["Dotonbori + the Glico sign", "Osaka Castle", "Shinsekai retro district"],
      food: ["Takoyaki + okonomiyaki in Dotonbori", "kushikatsu in Shinsekai"],
      transit: "~15 min from Kyoto by special rapid; central base for the west.",
      tip: "‘Kuidaore’ — eat till you drop. Pace yourself across small plates.",
    },
    {
      day: "Day 8–9", name: "Hiroshima", lat: 34.39, lng: 132.46, emoji: "🕊️",
      blurb: "A moving, hopeful city. Stand at the Peace Memorial, then eat the city's signature layered okonomiyaki.",
      highlights: ["Peace Memorial Park + Museum", "A-Bomb Dome", "Shukkeien garden"],
      food: ["Hiroshima-style okonomiyaki (with noodles)", "fresh oysters"],
      transit: "~1h40 shinkansen Osaka→Hiroshima.",
      tip: "Give the Peace Museum a slow, unhurried morning.",
    },
    {
      day: "Day 10", name: "Miyajima", lat: 34.30, lng: 132.32, emoji: "⛩️",
      blurb: "End at the floating torii of Itsukushima — vermilion against the tide, deer on the paths, and ropeway views over the Inland Sea.",
      highlights: ["Itsukushima floating torii", "Mt Misen ropeway", "Daisho-in temple"],
      food: ["Grilled oysters on the stick", "momiji manju (maple cakes)"],
      transit: "Train + 10-min ferry from Hiroshima.",
      tip: "Check the tide chart — high tide for the float, low tide to walk to the gate.",
    },
  ],
};

export default function App({ sdk }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const [open, setOpen] = useState<number | null>(0);
  const [favs, setFavs] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void sdk.storage.get("favorites").then((f) => Array.isArray(f) && setFavs(f as string[])).catch(() => {});
  }, []);

  const stops: MapStop[] = useMemo(
    () => TRIP.stops.map((s, i) => ({ name: s.name, lat: s.lat, lng: s.lng, day: i + 1 })),
    [],
  );

  function toggleFav(name: string) {
    sfx.click();
    const next = favs.includes(name) ? favs.filter((n) => n !== name) : [...favs, name];
    setFavs(next);
    void sdk.storage.set("favorites", next).catch(() => {});
  }

  async function ask() {
    if (!q.trim() || asking) return;
    setAsking(true);
    setAnswer("");
    const ctxText = TRIP.stops.map((s) => `${s.name}: ${s.blurb} Food: ${s.food.join("; ")}. Tip: ${s.tip}`).join("\n");
    try {
      const { text } = await sdk.ai.chat([
        { role: "system", content: `You are a friendly guide for this exact ${TRIP.days}-day Japan itinerary:\n${ctxText}\nAnswer only about this trip, briefly and warmly.` },
        { role: "user", content: q },
      ]);
      setAnswer(text?.trim() || "Hmm, ask me about a city, food, or getting around!");
    } catch {
      setAnswer("Open inside SuperJam to ask the guide. Meanwhile: every stop above has food picks and a tip ✨");
    }
    setAsking(false);
  }

  return (
    <div className="tj-card">
      {/* hero */}
      <div style={{ borderRadius: 16, padding: "28px 18px", marginBottom: 12, color: "#fff",
        background: "linear-gradient(135deg,#FF4767,#9B7BFF 55%,#3E63F2)", textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>🗾</div>
        <h1 className="tj-title" style={{ color: "#fff", margin: "4px 0" }}>{TRIP.title}</h1>
        <p style={{ opacity: 0.95, margin: 0, fontWeight: 600 }}>
          {TRIP.days} days · {TRIP.stops.length} stops · {TRIP.stops[0]!.name} → {TRIP.stops[TRIP.stops.length - 1]!.name}
        </p>
      </div>

      <MiniMap stops={stops} height={250} />

      <div className="tj-list" style={{ marginTop: 12 }}>
        {TRIP.stops.map((s, i) => {
          const isOpen = open === i;
          const faved = favs.includes(s.name);
          return (
            <div key={s.name} className="tj-card" style={{ padding: 12 }}>
              <div className="tj-row" style={{ alignItems: "center", gap: 12, cursor: "pointer" }}
                onClick={() => { sfx.click(); setOpen(isOpen ? null : i); }}>
                <div style={{ width: 52, height: 52, borderRadius: 12, display: "grid", placeItems: "center",
                  fontSize: 26, background: "#FFE9C7", flexShrink: 0 }}>{s.emoji}</div>
                <div style={{ flex: 1 }}>
                  <strong>{s.day} · {s.name}</strong>
                  <div className="tj-muted" style={{ fontSize: 13 }}>{s.transit}</div>
                </div>
                <button className="tj-btn" onClick={(e) => { e.stopPropagation(); toggleFav(s.name); }}
                  style={{ background: faved ? "#F5B53C" : "#ECE6F6", padding: "6px 10px" }}
                  aria-label="bookmark">{faved ? "★" : "☆"}</button>
              </div>
              {isOpen && (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <p style={{ margin: 0 }}>{s.blurb}</p>
                  <Section label="See" items={s.highlights} />
                  <Section label="Eat" items={s.food} />
                  <p className="tj-muted" style={{ margin: 0, fontSize: 13 }}>💡 {s.tip}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ask the guide */}
      <h2 className="tj-title" style={{ fontSize: 18, marginTop: 18 }}>💬 Ask the guide</h2>
      <div className="tj-row">
        <input className="tj-input" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Vegetarian food in Kyoto?" style={{ flex: 1 }} />
        <button className="tj-btn" onClick={ask} disabled={asking} style={{ background: "#18B877" }}>
          {asking ? "…" : "Ask"}
        </button>
      </div>
      {answer && <p style={{ marginTop: 8, background: "#F4F0FF", padding: 10, borderRadius: 10 }}>{answer}</p>}
    </div>
  );
}

function Section({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <strong style={{ fontSize: 13 }}>{label}</strong>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {items.map((it) => <li key={it} style={{ fontSize: 13 }}>{it}</li>)}
      </ul>
    </div>
  );
}
