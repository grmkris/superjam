// photo-album — a BAKED travel photo album. The maker uploads photos at BUILD
// time; the harness (NOT the agent, NOT the end-user) downloads them into
// `public/uploads/`, pre-extracts each photo's GPS + capture time from EXIF, and
// writes a manifest at `public/photos.json`. The deployed app IS the finished
// album: the end-user just VIEWS it (no runtime upload). This kit renders the
// geotagged photos on the seeded `<TripMap>` and lays out ALL photos on a
// timeline/grid sorted by capture time.
//
// THE BAKED-MEDIA CONTRACT — `public/photos.json` (written by the harness):
//   [ { "file": "uploads/0.jpg", "lat": 41.9, "lng": 12.5, "takenAt": 1690000000000 },
//     { "file": "uploads/1.jpg", "lat": null, "lng": null, "takenAt": null } ]
//   - `file`  : path relative to `public/` → render `<img src={"/" + p.file} />`
//               (so "uploads/0.jpg" → "/uploads/0.jpg").
//   - `lat`/`lng`: number OR null (no GPS EXIF on that photo).
//   - `takenAt`: epoch ms OR null (no capture-time EXIF).
// The app reads it at runtime with `fetch("/photos.json")` — it's a static file
// served at the site root, and the photos are ALREADY in the deployed bundle.
//
// SELF-CONNECT pattern (proven by the known-good builds): a "use client"
// default-export page that obtains the sdk itself via `SuperJam.connect()` inside
// a useEffect. We only use the sdk to identify the viewer; all album data comes
// from the baked `/photos.json` manifest.
//
// MAP: this kit declares `skills: ["map"]`, so the generator seeds
// `components/trip-map.tsx` (the keyless MapLibre <TripMap>). We IMPORT it — never
// rewrite it, never add another map library.
import type { AppSpec, SkillName } from "@superjam/shared";
import type { GateResult, Kit, KitContext } from "./types.ts";

// Mirrors selectRecipes' keyword heuristic. NB: image uploads are REQUIRED — this
// kit only fires when the maker actually uploaded photos at build time.
const ALBUM_RE = /album|photos?|gallery|trip|travel|memories|recap|scrapbook/i;

const match = (spec: AppSpec, opts?: { imageCount?: number }): boolean => {
  if ((opts?.imageCount ?? 0) <= 0) return false; // no uploads ⇒ not a baked album
  const hay = `${spec.name} ${spec.description} ${spec.features.join(" ")}`;
  return ALBUM_RE.test(hay);
};

const skills: SkillName[] = ["map"];

const questions: Kit["questions"] = [
  {
    q: "How should the photos be grouped?",
    options: ["By day (a trip timeline)", "By place (cluster on the map)", "One flat chronological stream"],
  },
  {
    q: "Draw the travel route line between geotagged photos?",
    options: ["Yes — connect them in order", "No — just pins", "Only when there are 3+ stops"],
  },
  {
    q: "How should captions read?",
    options: ["Date + place", "A short blurb per photo", "Just the photo number", "No captions — let the images speak"],
  },
];

const plan = (spec: AppSpec): string => {
  const emoji = spec.iconEmoji;
  const feats = spec.features.length
    ? spec.features.map((f) => `   - ${f}`).join("\n")
    : "   - (no extra features declared — keep it a clean map + timeline)";
  return `# Build plan — ${emoji} ${spec.name} (baked travel photo album)

The maker's photos are ALREADY baked into this app. The harness downloaded them
to \`public/uploads/\` and wrote a manifest at \`public/photos.json\`:
  [ { "file": "uploads/0.jpg", "lat": 41.9, "lng": 12.5, "takenAt": 1690000000000 },
    { "file": "uploads/1.jpg", "lat": null, "lng": null, "takenAt": null } ]
There is NO runtime upload — the end-user only VIEWS the finished album.

1. \`"use client"\` page. Connect once on mount: \`const sdk = await SuperJam.connect()\`
   inside a useEffect (self-connect pattern), then \`sdk.app.context()\` to greet
   the viewer. The album data does NOT come from the sdk.
2. Load the baked manifest: \`fetch("/photos.json").then(r => r.json())\` → an array
   of \`{ file, lat, lng, takenAt }\`. Guard fetch failure (default to \`[]\`).
   Each \`file\` is relative to \`public/\` → render \`<img src={"/" + p.file} />\`.
3. Derive map stops: keep only photos with FINITE lat/lng (skip the null ones),
   name them ("Photo 1", "Photo 2", …) and group \`day\` by calendar date from
   \`takenAt\`. Build a \`TripStop[]\` and render \`<TripMap stops={geoStops} />\`.
4. Render the TIMELINE/grid of ALL photos (geotagged or not), sorted by
   \`takenAt\` (nulls last), as \`<img src={"/" + p.file} loading="lazy" alt=... />\`.
   Add a graceful note for photos WITHOUT GPS ("not on the map").
5. Empty state: if \`/photos.json\` is missing or empty, show a friendly "no
   photos in this album yet" card — don't crash.
6. Polish: lightbox on tap, day group-headers on the timeline, a caption overlay
   (date/place) per photo.
7. Wire the spec's specifics:
${feats}
8. Acceptance: the map plots the geotagged photos, the timeline shows every
   uploaded image, and photos without GPS still appear (just not on the map).`;
};

// A near-complete, TYPE-CORRECT starter. It compiles as-is — the `// TODO:` gaps
// are COSMETIC (lightbox, day headers, caption overlay), not core logic.
const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const page = `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { TripMap, type TripStop } from "@/components/trip-map";
import { useEffect, useMemo, useState } from "react";

// ${title} — a BAKED travel photo album. Photos live in public/uploads/ and the
// harness wrote public/photos.json; the end-user only views it (no upload).
type Photo = { file: string; lat: number | null; lng: number | null; takenAt: number | null };

// A photo is "geotagged" when it has finite coordinates in valid ranges.
function hasCoords(p: Photo): p is Photo & { lat: number; lng: number } {
  return (
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

const dayKey = (ms: number | null): string => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

export default function Page() {
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect for the viewer's identity, and load the baked manifest.
  useEffect(() => {
    (async () => {
      try {
        const s: SuperJamSdk = await SuperJam.connect();
        setCtx(s.app.context());
      } catch {
        // identity is optional — the album still renders for anyone.
      }
      try {
        const res = await fetch("/photos.json");
        const raw: unknown = res.ok ? await res.json() : [];
        setPhotos(Array.isArray(raw) ? (raw as Photo[]) : []);
      } catch {
        setPhotos([]); // missing/broken manifest ⇒ graceful empty album
      }
      setLoading(false);
    })();
  }, []);

  // Map stops: only geotagged photos, numbered, day-grouped by calendar date.
  const geoStops = useMemo<TripStop[]>(() => {
    const geo = photos.filter(hasCoords).sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0));
    const days = [...new Set(geo.map((p) => dayKey(p.takenAt)).filter(Boolean))];
    return geo.map((p, i) => ({
      name: \`Photo \${i + 1}\`,
      lat: p.lat,
      lng: p.lng,
      day: p.takenAt ? days.indexOf(dayKey(p.takenAt)) + 1 : undefined,
      blurb: p.takenAt ? new Date(p.takenAt).toLocaleDateString() : undefined,
    }));
  }, [photos]);

  // Timeline: ALL photos, oldest first; undated ones sink to the end.
  const timeline = useMemo<Photo[]>(
    () => [...photos].sort((a, b) => (a.takenAt ?? Infinity) - (b.takenAt ?? Infinity)),
    [photos],
  );

  const me = ctx?.user.username ?? "friend";
  const noGps = photos.length - geoStops.length;

  if (loading) {
    return (
      <main className="tj-app tj-center">
        <div className="tj-card">
          <div className="tj-spin" />
          <p className="tj-sub">Loading ${title}…</p>
        </div>
      </main>
    );
  }

  if (photos.length === 0) {
    return (
      <main className="tj-app tj-center">
        <div className="tj-card">
          <h1 className="tj-title">${emoji} ${title}</h1>
          <div className="tj-empty">No photos in this album yet.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="tj-app">
      <div className="tj-card">
        <h1 className="tj-title">${emoji} ${title}</h1>
        <p className="tj-sub">Welcome, @{me} — {photos.length} photos from the trip.</p>
      </div>

      {/* The map plots every geotagged photo in capture order. */}
      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>On the map 🗺️</h2>
        <TripMap stops={geoStops} height={340} />
        {noGps > 0 && (
          <p className="tj-muted">{noGps} photo{noGps === 1 ? "" : "s"} without GPS — see the timeline below.</p>
        )}
      </div>

      {/* The timeline shows ALL photos, geotagged or not, oldest first. */}
      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18 }}>Timeline 📸</h2>
        {/* TODO: insert day group-headers (a "Day 1 — <date>" row) when the
            calendar date changes between consecutive photos. */}
        <div className="tj-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {timeline.map((p, i) => (
            <figure key={p.file} style={{ margin: 0, position: "relative" }}>
              {/* TODO: open a lightbox on tap (click the image → full-screen). */}
              <img
                src={"/" + p.file}
                alt={\`Photo \${i + 1}\${p.takenAt ? " — " + new Date(p.takenAt).toLocaleDateString() : ""}\`}
                loading="lazy"
                style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 10, display: "block" }}
              />
              {/* TODO: caption overlay — show the date/place over the image corner. */}
              {!hasCoords(p) && <figcaption className="tj-muted" style={{ fontSize: 12 }}>not on the map</figcaption>}
            </figure>
          ))}
        </div>
      </div>
    </main>
  );
}
`;
  return { "app/page.tsx": page };
};

// Kit gate — runs ALONGSIDE the generic gate. FUNCTIONAL probes only: the app
// must consume the baked manifest, render the uploaded images, and use the seeded
// map. We deliberately do NOT flag leftover // TODO (those gaps are cosmetic).
const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  if (!/\/photos\.json/.test(page)) {
    missing.push('fetch the baked manifest with fetch("/photos.json")');
  }
  // Render the uploaded images: an <img> whose src derives from the photo file
  // path ("uploads/…" or "/" + p.file) — accept any of these shapes.
  if (!(/uploads\//.test(page) || /\/" ?\+ ?\w+\.file/.test(page) || /<img/.test(page))) {
    missing.push('render the uploaded photos as <img src={"/" + p.file} /> (from public/uploads/)');
  }
  if (!/<TripMap\b/.test(page)) {
    missing.push("plot the geotagged photos with the seeded <TripMap /> component");
  }
  return { ok: missing.length === 0, missing };
};

export const photoAlbumKit: Kit = {
  id: "photo-album",
  title: "Travel photo album",
  skills,
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
