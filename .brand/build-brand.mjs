// SuperJam brand assets — logo (512×512) + cover (640×360).
// Toybox identity from apps/web/src/app/globals.css: cream paper, chunky ink
// outlines, hard offset "sticker" shadows, candy fills, Baloo 2 display type.
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";

const C = {
  cream: "#fff4e3",
  card: "#ffffff",
  ink: "#221a33",
  pink: "#ff4d6d",
  yellow: "#ffc940",
  green: "#2fd180",
  blue: "#4d7cff",
  lavender: "#c9b6ff",
};

const FONTS = [".brand/fonts/Baloo2-800.ttf", ".brand/fonts/Baloo2-700.ttf"];

// ── geometry helpers ───────────────────────────────────────────────────────
// N-point star (use points=5 for ★, points=4 for ✦ sparkle).
function star(cx, cy, outer, inner, points, rotDeg = -90) {
  const pts = [];
  const step = Math.PI / points;
  let a = (rotDeg * Math.PI) / 180;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
    a += step;
  }
  return `M${pts.join("L")}Z`;
}

// Canonical lightning bolt in a normalised 0..1 box, comfortably inset so it
// never clips the tile edge. Scaled into any tile via boltInBox().
const BOLT_N = [
  [0.6, 0.16], [0.34, 0.54], [0.5, 0.54],
  [0.4, 0.84], [0.66, 0.46], [0.5, 0.46],
];
const boltInBox = (x, y, s) =>
  "M" + BOLT_N.map(([nx, ny]) => `${(x + nx * s).toFixed(1)},${(y + ny * s).toFixed(1)}`).join("L") + "Z";

const play = (cx, cy, s) =>
  `M${cx - 0.3 * s},${cy - 0.4 * s} L${cx + 0.46 * s},${cy} L${cx - 0.3 * s},${cy + 0.4 * s} Z`;

const heart = (cx, cy, s) => {
  // simple cubic heart, width≈height≈s
  const w = 0.5 * s, h = 0.46 * s;
  return `M${cx},${cy + h} C${cx - w * 2},${cy - h * 0.5} ${cx - w * 0.6},${cy - h * 1.7} ${cx},${cy - h * 0.4} C${cx + w * 0.6},${cy - h * 1.7} ${cx + w * 2},${cy - h * 0.5} ${cx},${cy + h} Z`;
};

// A candy sticker tile: hard ink drop-shadow + ink-outlined rounded square,
// with an optional ink/white motif drawn inside. Tilted about its centre.
function tile({ x, y, size, fill, tilt = 0, motif, motifColor = C.ink, outline = 5, drop = 5 }) {
  const rx = size * 0.28;
  const cx = x + size / 2, cy = y + size / 2;
  let inner = "";
  if (motif === "play") inner = `<path d="${play(cx, cy, size)}" fill="${motifColor}"/>`;
  else if (motif === "heart") inner = `<path d="${heart(cx, cy, size * 0.9)}" fill="${motifColor}"/>`;
  else if (motif === "star") inner = `<path d="${star(cx, cy, size * 0.34, size * 0.15, 5)}" fill="${motifColor}"/>`;
  else if (motif === "coin")
    inner = `<circle cx="${cx}" cy="${cy}" r="${size * 0.3}" fill="none" stroke="${motifColor}" stroke-width="${size * 0.1}"/><circle cx="${cx}" cy="${cy}" r="${size * 0.1}" fill="${motifColor}"/>`;
  else if (motif === "spark") inner = `<path d="${star(cx, cy, size * 0.34, size * 0.1, 4, -90)}" fill="${motifColor}"/>`;
  return `
  <g transform="rotate(${tilt} ${cx} ${cy})">
    <rect x="${x}" y="${y + drop}" width="${size}" height="${size}" rx="${rx}" fill="${C.ink}"/>
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${rx}" fill="${fill}" stroke="${C.ink}" stroke-width="${outline}"/>
    ${inner}
  </g>`;
}

// Free-standing sparkle (no tile).
const sparkle = (cx, cy, r, color) =>
  `<path d="${star(cx, cy, r, r * 0.3, 4, -90)}" fill="${color}"/>`;

// ── LOGO 512×512 — full-bleed yellow app-icon ───────────────────────────────
// The yellow rounded tile fills the frame (thin transparent gutter so the
// rounded corners read on any background), a chunky ink keyline just inside the
// edge keeps the Toybox ink-outline identity, and one bold ink bolt centred.
function logoSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="8" y="8" width="496" height="496" rx="116" fill="${C.yellow}"/>
  <rect x="22" y="22" width="468" height="468" rx="102" fill="none" stroke="${C.ink}" stroke-width="14"/>
  <path d="${boltInBox(76, 76, 360)}" fill="${C.ink}" stroke="${C.ink}" stroke-width="12" stroke-linejoin="round"/>
</svg>`;
}

// ── COVER 640×360 (16:9) — wordmark + tagline + scattered candy tiles ───────
function coverSVG() {
  const tileX = 84, tileY = 112, tileS = 92, tileRx = 26;
  const bolt = boltInBox(tileX, tileY, tileS); // small ⚡ in tile
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="${C.cream}"/>

  <!-- decorative candy tiles, one per corner; sparkles fill the mid-gutters -->
  ${tile({ x: 42, y: 46, size: 60, fill: C.green, tilt: -10, motif: "play", motifColor: C.card })}
  ${tile({ x: 538, y: 42, size: 58, fill: C.lavender, tilt: 9, motif: "heart", motifColor: C.pink })}
  ${tile({ x: 40, y: 250, size: 60, fill: C.blue, tilt: 8, motif: "star", motifColor: C.card })}
  ${tile({ x: 540, y: 250, size: 62, fill: C.yellow, tilt: -8, motif: "coin", motifColor: C.ink })}
  ${sparkle(300, 56, 13, C.ink)}
  ${sparkle(612, 168, 12, C.blue)}
  ${sparkle(158, 240, 10, C.pink)}
  ${sparkle(498, 240, 11, C.green)}

  <!-- lightning token tile -->
  <rect x="${tileX}" y="${tileY + 7}" width="${tileS}" height="${tileS}" rx="${tileRx}" fill="${C.ink}"/>
  <rect x="${tileX}" y="${tileY}" width="${tileS}" height="${tileS}" rx="${tileRx}" fill="${C.yellow}" stroke="${C.ink}" stroke-width="7"/>
  <path d="${bolt}" fill="${C.ink}" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round"/>

  <!-- wordmark: pink fill, ink outline, hard ink drop -->
  <text x="200" y="186" font-family="Baloo 2" font-weight="800" font-size="92"
        fill="${C.ink}">superjam</text>
  <text x="200" y="180" font-family="Baloo 2" font-weight="800" font-size="92"
        fill="${C.pink}" stroke="${C.ink}" stroke-width="6" paint-order="stroke" stroke-linejoin="round">superjam</text>

  <!-- tagline -->
  <text x="320" y="262" text-anchor="middle" font-family="Baloo 2" font-weight="700"
        font-size="30" fill="${C.ink}">make a jam. share the jam.</text>
</svg>`;
}

// ── OG / TWITTER CARD 1200×630 — social share image (same composition, big) ─
function ogSVG() {
  const tS = 150, tX = 196, tY = 225, tRx = 42;
  const wordX = tX + tS + 34, base = 350;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${C.cream}"/>

  ${tile({ x: 70, y: 70, size: 100, fill: C.green, tilt: -10, motif: "play", motifColor: C.card, outline: 7, drop: 8 })}
  ${tile({ x: 1030, y: 64, size: 96, fill: C.lavender, tilt: 9, motif: "heart", motifColor: C.pink, outline: 7, drop: 8 })}
  ${tile({ x: 78, y: 440, size: 100, fill: C.blue, tilt: 8, motif: "star", motifColor: C.card, outline: 7, drop: 8 })}
  ${tile({ x: 1028, y: 448, size: 104, fill: C.yellow, tilt: -8, motif: "coin", motifColor: C.ink, outline: 7, drop: 8 })}
  ${sparkle(562, 98, 23, C.ink)}
  ${sparkle(1148, 294, 21, C.blue)}
  ${sparkle(296, 420, 18, C.pink)}
  ${sparkle(934, 420, 19, C.green)}

  <!-- lightning token tile -->
  <rect x="${tX}" y="${tY + 9}" width="${tS}" height="${tS}" rx="${tRx}" fill="${C.ink}"/>
  <rect x="${tX}" y="${tY}" width="${tS}" height="${tS}" rx="${tRx}" fill="${C.yellow}" stroke="${C.ink}" stroke-width="11"/>
  <path d="${boltInBox(tX, tY, tS)}" fill="${C.ink}" stroke="${C.ink}" stroke-width="9" stroke-linejoin="round"/>

  <!-- wordmark -->
  <text x="${wordX}" y="${base + 10}" font-family="Baloo 2" font-weight="800" font-size="150" fill="${C.ink}">superjam</text>
  <text x="${wordX}" y="${base}" font-family="Baloo 2" font-weight="800" font-size="150"
        fill="${C.pink}" stroke="${C.ink}" stroke-width="9" paint-order="stroke" stroke-linejoin="round">superjam</text>

  <!-- tagline -->
  <text x="600" y="470" text-anchor="middle" font-family="Baloo 2" font-weight="700" font-size="46" fill="${C.ink}">make a jam. share the jam.</text>
</svg>`;
}

// ── render ──────────────────────────────────────────────────────────────────
function render(svg, outPng, width) {
  const r = new Resvg(svg, {
    background: "transparent",
    fitTo: { mode: "width", value: width },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Baloo 2" },
  });
  writeFileSync(outPng, r.render().asPng());
}

const logo = logoSVG();
const cover = coverSVG();
const og = ogSVG();

// editable source + standalone assets
writeFileSync(".brand/logo.svg", logo);
writeFileSync(".brand/cover.svg", cover);
writeFileSync(".brand/og.svg", og);
render(logo, ".brand/logo-512.png", 512);
render(cover, ".brand/cover-640x360.png", 640);
render(og, ".brand/og-1200x630.png", 1200);

// Next.js App Router file-based metadata (apps/web/src/app/*) — auto-wired into
// <link rel="icon">, apple-touch-icon, and og:image / twitter:image tags.
const APP = "apps/web/src/app";
render(logo, `${APP}/icon.png`, 512);
render(logo, `${APP}/apple-icon.png`, 180);
render(og, `${APP}/opengraph-image.png`, 1200);
render(og, `${APP}/twitter-image.png`, 1200);

console.log("wrote .brand/* and apps/web/src/app/{icon,apple-icon,opengraph-image,twitter-image}.png");
