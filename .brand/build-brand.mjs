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

// ── LOGO 512×512 — the yellow ⚡ token as a peelable sticker ─────────────────
function logoSVG() {
  // tile centred, room left below for the hard ink shadow
  const x = 96, y = 92, s = 320, rx = 92, drop = 18, outline = 16;
  const bolt = "M300,150 L196,300 L262,300 L214,420 L322,268 L256,268 Z";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${C.cream}"/>
  <rect x="${x}" y="${y + drop}" width="${s}" height="${s}" rx="${rx}" fill="${C.ink}"/>
  <rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${rx}" fill="${C.yellow}" stroke="${C.ink}" stroke-width="${outline}"/>
  <path d="${bolt}" fill="${C.ink}" stroke="${C.ink}" stroke-width="10" stroke-linejoin="round"/>
  ${sparkle(118, 120, 16, C.ink)}
  ${sparkle(404, 410, 13, C.pink)}
</svg>`;
}

// ── COVER 640×360 (16:9) — wordmark + tagline + scattered candy tiles ───────
function coverSVG() {
  const bolt = "M118,108 L86,165 L106,165 L90,205 L124,150 L104,150 Z"; // small ⚡ in tile
  const tileX = 84, tileY = 112, tileS = 92, tileRx = 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="${C.cream}"/>

  <!-- decorative candy tiles in the gutters -->
  ${tile({ x: 40, y: 44, size: 60, fill: C.green, tilt: -10, motif: "play", motifColor: C.card })}
  ${tile({ x: 542, y: 40, size: 56, fill: C.lavender, tilt: 9, motif: "heart", motifColor: C.pink })}
  ${tile({ x: 36, y: 250, size: 58, fill: C.blue, tilt: 8, motif: "star", motifColor: C.card })}
  ${tile({ x: 548, y: 252, size: 60, fill: C.yellow, tilt: -8, motif: "coin", motifColor: C.ink })}
  ${tile({ x: 470, y: 300, size: 44, fill: C.pink, tilt: 11, motif: "spark", motifColor: C.card })}
  ${sparkle(150, 70, 12, C.ink)}
  ${sparkle(498, 300, 11, C.green)}
  ${sparkle(610, 150, 10, C.blue)}

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
writeFileSync(".brand/logo.svg", logo);
writeFileSync(".brand/cover.svg", cover);
render(logo, ".brand/logo-512.png", 512);
render(cover, ".brand/cover-640x360.png", 640);
console.log("wrote .brand/{logo.svg,logo-512.png,cover.svg,cover-640x360.png}");
