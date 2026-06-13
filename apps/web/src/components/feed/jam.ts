// Feed data model (DESIGN_BRIEF §3b). A FeedJam carries everything the card
// shows PLUS the fields AppFrame needs to actually play the jam in-feed (it's a
// superset of ViewerApp). loadFeed pulls the real Discover feed from
// apps.explore and maps it 1:1; presentation-only bits (accent, tagline) are
// derived client-side.
import type { AppRouterClient } from "@superjam/api/client";
import type { ViewerApp } from "../app-frame";

export type Accent = "blue" | "pink" | "green" | "yellow";

export interface FeedJam extends ViewerApp {
  maker: { username: string; verified: boolean };
  tagline: string;
  accent: Accent;
  likes: number;
  likedByMe: boolean;
  comments: number;
  friendsLiked: number;
  remixOf: { name: string } | null;
}

export type FeedTab = "foryou" | "friends" | "new";

const ACCENTS: Accent[] = ["blue", "pink", "green", "yellow"];
const accentFor = (seed: string): Accent =>
  ACCENTS[
    [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % ACCENTS.length
  ] as Accent;

export async function loadFeed(
  client: AppRouterClient,
  tab: FeedTab = "foryou"
): Promise<FeedJam[]> {
  try {
    const res = await client.apps.explore({ tab });
    return res.jams.map((j) => ({
      id: j.id,
      slug: j.slug,
      name: j.name,
      iconEmoji: j.iconEmoji,
      category: j.category,
      // explore only returns live apps (entryUrl filtered non-null); coalesce
      // for the type since the column is nullable.
      entryUrl: j.entryUrl ?? "",
      entryOrigin: j.entryOrigin,
      capabilities: j.capabilities,
      ensName: j.ensName,
      maker: j.maker,
      tagline: j.description || "a little app, made on superjam ✨",
      accent: accentFor(j.slug),
      likes: j.likes,
      likedByMe: j.likedByMe,
      comments: j.comments,
      friendsLiked: j.friendsLiked,
      remixOf: j.remixOf,
    }));
  } catch {
    return [];
  }
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
