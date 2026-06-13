// Seed-jam gallery manifest (§10/§11). The platform imports SEED_JAMS to seed
// the Discover feed: bundle each `entry`, register an app row from `manifest`,
// done. `builderExemplar` marks the two canonical apps the build agent seeds
// into every workspace (tip-jar is also the e2e build fixture). Validated
// against the shared schemas in scripts/verify.ts so a typo fails CI.
import { AppManifestSchema, type AppManifest, type SkillName } from "@superjam/shared/appspec";

export type SeedJam = {
  /** workspace-relative entry source (placed at src/app.tsx by the builder). */
  entry: string;
  manifest: AppManifest;
  /** skill recipes this jam exercises (subset of the §10 registry). */
  skills: SkillName[];
  /** seeded into every build workspace as a worked example (§10 examples/). */
  builderExemplar?: boolean;
};

export const SEED_JAMS: SeedJam[] = [
  {
    entry: "examples/tip-jar.tsx",
    builderExemplar: true,
    skills: [],
    manifest: {
      name: "Tip Jar",
      slug: "tip-jar",
      description: "Send the squad a private USDC tip and climb the tippers leaderboard.",
      iconEmoji: "🫙",
      category: "tool",
      capabilities: ["payments"],
    },
  },
  {
    entry: "examples/guestbook.tsx",
    builderExemplar: true,
    skills: [],
    manifest: {
      name: "Fan Wall",
      slug: "fan-wall",
      description: "Sign the shared wall with your country and a message. Drafts autosave.",
      iconEmoji: "✍️",
      category: "social",
      capabilities: [],
    },
  },
  {
    entry: "examples/gem-clicker-3d.tsx",
    skills: ["game-3d"],
    manifest: {
      name: "Golden Boot",
      slug: "golden-boot",
      description: "Tap spinning footballs before full time. All-time goals leaderboard.",
      iconEmoji: "⚽",
      category: "game",
      capabilities: [],
    },
  },
  {
    entry: "examples/live-poll.tsx",
    skills: ["charts"],
    manifest: {
      name: "World Cup Picks",
      slug: "world-cup-picks",
      description: "Vote your champion and watch the live bar chart fill up. One vote per fan.",
      iconEmoji: "🏆",
      category: "social",
      capabilities: [],
    },
  },
  {
    entry: "examples/drawing-contest.tsx",
    skills: ["judge"],
    manifest: {
      name: "Mascot Draw-off",
      slug: "mascot-draw-off",
      description: "Draw the mascot; an AI judge scores it and ranks the gallery.",
      iconEmoji: "🎨",
      category: "creative",
      capabilities: ["ai"],
    },
  },
  {
    entry: "examples/trivia-duel.tsx",
    skills: [],
    manifest: {
      name: "Trivia Duel",
      slug: "trivia-duel",
      description: "Answer World Cup trivia and challenge a friend with a share link.",
      iconEmoji: "⚽",
      category: "game",
      capabilities: ["ai", "social"],
    },
  },
  {
    entry: "examples/match-pot.tsx",
    skills: ["market"],
    manifest: {
      name: "Final Pot",
      slug: "final-pot",
      description: "Escrowed match wager that resolves itself when the game ends.",
      iconEmoji: "⚽",
      category: "game",
      capabilities: ["payments"],
    },
  },
];

// Eager self-check (also re-run in scripts/verify.ts): every manifest is valid.
for (const jam of SEED_JAMS) AppManifestSchema.parse(jam.manifest);
