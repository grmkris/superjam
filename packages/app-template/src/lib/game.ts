// Tiny game helpers for generated mini apps. No assets, no globals.
import { useEffect, useRef } from "react";

/** requestAnimationFrame loop. dt is SECONDS (capped at 50ms). Mutate refs in
 *  the callback — never call setState every frame (re-render per frame kills
 *  perf); sync to React state at most a few times per second. */
export function useRaf(cb: (dt: number) => void, running = true) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!running) return;
    let id = 0;
    let last = performance.now();
    const loop = (t: number) => {
      ref.current(Math.min((t - last) / 1000, 0.05));
      last = t;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [running]);
}

/** Held-key map for game movement. Read inside a useRaf callback:
 *  `if (keys.current["ArrowLeft"]) x -= speed * dt`. Desktop only — always
 *  ALSO render on-screen touch buttons for phones. */
export function useKeys() {
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { keys.current[e.key] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.key] = false; };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return keys;
}

export const rand = (min: number, max: number) => min + Math.random() * (max - min);
export const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Box = { x: number; y: number; w: number; h: number };
/** axis-aligned overlap test for 2D collision */
export const aabb = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
