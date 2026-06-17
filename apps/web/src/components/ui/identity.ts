// Deterministic per-seed identity — ONE source so a person or jam looks the same
// everywhere (feed poster, reviews, profile). Pure `string → value`, no state, no
// persistence; stable for a given seed. Consolidates three previously-duplicated
// copies (j/[slug] avatars, u/[username] + feed/jam accents) that had drifted to
// different array orders, so the same user used to get different accents per screen.

export type Accent = "blue" | "pink" | "green" | "yellow";

const ACCENTS: Accent[] = ["blue", "pink", "green", "yellow"];

// A friendly animal cast — a crowd, never one repeated 🙂.
const AVATARS = [
  "🦊", "🐱", "🐸", "🐼", "🐨", "🐰", "🐯", "🐵",
  "🦉", "🐙", "🦄", "🐝", "🐧", "🐢", "🦋", "🐳",
];

// Stable rolling hash over the seed (h*31 + char).
const hash = (seed: string): number => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** A stable candy accent for a seed (a username or a jam slug). */
export const accentFor = (seed: string): Accent =>
  ACCENTS[hash(seed) % ACCENTS.length]!;

/** A stable animal-avatar emoji for a person (by username). */
export const avatarEmoji = (seed: string): string =>
  AVATARS[hash(seed) % AVATARS.length] ?? "🙂";
