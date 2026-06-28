import { describe, expect, it } from "bun:test";
import { genericGate } from "./gate.ts";

// A minimal, on-theme, SDK-using page that should PASS the generic gate.
const goodPage = `"use client";
import SuperJam from "@superjam/sdk";
import { useState, useEffect } from "react";
export default function Page() {
  const [n, setN] = useState(0);
  useEffect(() => {}, []);
  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header"><span className="tj-emoji">👆</span></div>
        <button className="tj-btn" onClick={() => setN(n + 1)}>Tap {n}</button>
      </div>
    </main>
  );
}`;

const seedPage = "export default function Page() { return <main>stub</main>; }";
const themeSeed = ":root { --bg: #FFF4E3; }\nbody { background-color: var(--bg); }";

describe("genericGate — look quality", () => {
  it("passes a real, on-theme, SDK-using page", () => {
    const r = genericGate(goodPage, seedPage, { themeNow: themeSeed, themeSeed, globals: "" });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("fails when the locked theme.css was modified", () => {
    const r = genericGate(goodPage, seedPage, {
      themeNow: themeSeed + "\nbody { background: #0b1020; }",
      themeSeed,
      globals: "",
    });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /LOCKED theme/.test(m))).toBe(true);
  });

  it("fails when globals.css paints the body a LIGHT background", () => {
    const r = genericGate(goodPage, seedPage, {
      themeNow: themeSeed,
      themeSeed,
      globals: "body { background: #ffffff; color: #111; }",
    });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /LIGHT page background/.test(m))).toBe(true);
  });

  it("fails when the page wraps a full-bleed LIGHT wrapper", () => {
    const lightPage = goodPage.replace(
      '<main className="tj-app">',
      '<main className="tj-app" style={{ minHeight: "100dvh", background: "#fafaf8" }}>'
    );
    const r = genericGate(lightPage, seedPage, { themeNow: themeSeed, themeSeed });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /LIGHT page background/.test(m))).toBe(true);
  });

  it("does NOT flag a LIGHT inner element (a badge) as a light page bg", () => {
    const innerLight = goodPage.replace(
      '<button className="tj-btn"',
      '<button className="tj-btn" style={{ background: "#ffffff" }}'
    );
    const r = genericGate(innerLight, seedPage, { themeNow: themeSeed, themeSeed });
    expect(r.missing.some((m) => /LIGHT page background/.test(m))).toBe(false);
  });

  it("does NOT flag a translucent-white (glass) full-bleed wash", () => {
    const glassPage = goodPage.replace(
      '<main className="tj-app">',
      '<main className="tj-app" style={{ minHeight: "100dvh", background: "rgba(255,255,255,0.05)" }}>'
    );
    const r = genericGate(glassPage, seedPage, { themeNow: themeSeed, themeSeed });
    expect(r.missing.some((m) => /LIGHT page background/.test(m))).toBe(false);
  });

  it("fails an unstyled page that doesn't compose the Stage classes", () => {
    const rawPage = `"use client";
import SuperJam from "@superjam/sdk";
import { useState } from "react";
export default function Page() {
  const [n, setN] = useState(0);
  return <div><button onClick={() => setN(n + 1)}>Tap {n}</button></div>;
}`;
    const r = genericGate(rawPage, seedPage, { themeNow: themeSeed, themeSeed, globals: "" });
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /Stage classes/.test(m))).toBe(true);
  });

  it("still catches the untouched stub", () => {
    const r = genericGate(seedPage, seedPage);
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => /untouched starter/.test(m))).toBe(true);
  });
});
