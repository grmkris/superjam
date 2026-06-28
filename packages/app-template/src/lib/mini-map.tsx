// Dependency-free trip map for the app-template sandbox: an auto-fit SVG plot of
// trip stops as day-coloured numbered markers joined by a dashed route line.
// Self-contained (no tiles, no remote URL) — the right fit for the local bundle.
//
// DEPLOYED apps get a richer, real interactive map: the builder seeds
// `components/trip-map.tsx` (MapLibre GL, free keyless tiles) when the spec
// carries the "map" skill. See apps/builder/recipes/map.md. This MiniMap mirrors
// its shape so the example reads the same.
import { useMemo } from "react";

export type MapStop = { name: string; lat: number; lng: number; day?: number };

// Refined Arcade palette — one hue per trip day (wraps after 6).
const DAY_COLORS = ["#3E63F2", "#FF4767", "#F5B53C", "#18B877", "#9B7BFF", "#FF8A3D"];
const INK = "#18151D";

const W = 600;
const H = 360;

export function MiniMap({ stops, height = 260 }: { stops: MapStop[]; height?: number }) {
  const proj = useMemo(() => {
    const pts = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (!pts.length) return [];
    const lats = pts.map((s) => s.lat);
    const lngs = pts.map((s) => s.lng);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    // Pad the bbox (and guard a zero-span single-point trip) so markers aren't on the edge.
    const padLat = Math.max((maxLat - minLat) * 0.3, 1.5);
    const padLng = Math.max((maxLng - minLng) * 0.3, 1.5);
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
    return pts.map((s) => ({
      ...s,
      x: ((s.lng - minLng) / (maxLng - minLng)) * W,
      y: ((maxLat - s.lat) / (maxLat - minLat)) * H,
    }));
  }, [stops]);

  const route = proj.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <div
      style={{
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #EBE9E4",
        background: "linear-gradient(165deg,#EEF1F6,#F4F2EC)",
        boxShadow: "0 1px 2px rgba(24,21,29,0.05), 0 10px 26px -10px rgba(24,21,29,0.14)",
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="mm-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={INK} floodOpacity="0.18" />
          </filter>
        </defs>
        {/* graticule — a whisper-quiet ink grid for map feel */}
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`v${i}`} x1={(i / 6) * W} y1={0} x2={(i / 6) * W} y2={H} stroke={INK} strokeWidth={1} opacity={0.06} />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(i / 4) * H} x2={W} y2={(i / 4) * H} stroke={INK} strokeWidth={1} opacity={0.06} />
        ))}
        {proj.length >= 2 && (
          <path
            d={route}
            fill="none"
            stroke={INK}
            strokeWidth={2.5}
            strokeDasharray="2 7"
            strokeLinecap="round"
            opacity={0.5}
          />
        )}
        {proj.map((p, i) => {
          const n = p.day ?? i + 1;
          const color = DAY_COLORS[(n - 1) % DAY_COLORS.length];
          return (
            <g key={i} filter="url(#mm-shadow)">
              <circle cx={p.x} cy={p.y} r={13} fill={color} stroke="#fff" strokeWidth={3} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">{n}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
