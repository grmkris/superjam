// Feed data model (DESIGN_BRIEF §3b). A FeedJam carries everything the card
// shows PLUS the fields AppFrame needs to actually play the jam in-feed (it's a
// superset of ViewerApp). Until %67's apps.explore lands, loadFeed() returns a
// curated demo set; swapping to the typed client is a one-liner (see TODO).
import type { Capability } from "@superjam/shared";
import type { ViewerApp } from "../app-frame";

export type Accent = "blue" | "pink" | "green" | "yellow";

export interface FeedJam extends ViewerApp {
  maker: { username: string; verified: boolean };
  tagline: string;
  accent: Accent;
  likes: number;
  comments: number;
  friendsPlayed: number;
  remixOf: { name: string } | null;
}

const CAPS: Capability[] = ["payments", "social", "ai"];

// Curated demo feed. TODO(seam %67): replace with
//   const jams = await client.apps.explore({ tab })
// once apps.explore is on the router; the shape maps 1:1 onto FeedJam.
const SAMPLE: FeedJam[] = [
  {
    id: "demo_trivia",
    slug: "trivia-night",
    name: "Trivia Night",
    iconEmoji: "🎯",
    category: "game",
    entryUrl: "https://trivia-night.superjam.fun",
    entryOrigin: "https://trivia-night.superjam.fun",
    capabilities: CAPS,
    ensName: "trivianight.mira.superjam.fun",
    maker: { username: "mira", verified: true },
    tagline: "5 questions, loser buys coffee ☕ — beat my 4/5!",
    accent: "blue",
    likes: 1200,
    comments: 48,
    friendsPlayed: 23,
    remixOf: { name: "Pub Quiz" },
  },
  {
    id: "demo_tipjar",
    slug: "tip-jar-plus",
    name: "Tip Jar Plus",
    iconEmoji: "🫙",
    category: "social",
    entryUrl: "https://tip-jar-plus.superjam.fun",
    entryOrigin: "https://tip-jar-plus.superjam.fun",
    capabilities: CAPS,
    ensName: "tipjarplus.kris.superjam.fun",
    maker: { username: "kris", verified: true },
    tagline: "drop a coin, leave a note 🪙 — top tipper wins the month",
    accent: "pink",
    likes: 860,
    comments: 31,
    friendsPlayed: 9,
    remixOf: null,
  },
  {
    id: "demo_doodle",
    slug: "doodle-duel",
    name: "Doodle Duel",
    iconEmoji: "🎨",
    category: "game",
    entryUrl: "https://doodle-duel.superjam.fun",
    entryOrigin: "https://doodle-duel.superjam.fun",
    capabilities: CAPS,
    ensName: "doodleduel.theo.superjam.fun",
    maker: { username: "theo", verified: true },
    tagline: "you draw, they guess — 60 seconds on the clock ✏️",
    accent: "green",
    likes: 540,
    comments: 17,
    friendsPlayed: 4,
    remixOf: null,
  },
];

export type FeedTab = "foryou" | "friends" | "new";

export async function loadFeed(_tab: FeedTab = "foryou"): Promise<FeedJam[]> {
  // TODO(seam %67): wire client.apps.explore({ tab }) here.
  return SAMPLE;
}

/** The subset AppFrame/AppHost needs to play the jam in-feed. */
export const toViewerApp = (j: FeedJam): ViewerApp => ({
  id: j.id,
  slug: j.slug,
  name: j.name,
  iconEmoji: j.iconEmoji,
  category: j.category,
  entryUrl: j.entryUrl,
  entryOrigin: j.entryOrigin,
  capabilities: j.capabilities,
  ensName: j.ensName,
});

export const compactCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}k` : `${n}`;
