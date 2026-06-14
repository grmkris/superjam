# Recipe index — archetype starting points for the agent-fill generator

Read `_base.md` first (the external-app contract: file layout, `SuperJam.connect()`, the two
data paths). Then read the recipe(s) that match the spec's `category` / `skills`. Each recipe
is a worked `app/page.tsx` (+ backend pattern where needed) to imitate — not to copy blindly.

Pick the recipe by intent:

| Recipe | Pick when the jam is… | Leans on | Backend? |
|---|---|---|---|
| `quiz.md` | a quiz / trivia / "guess the…" with a leaderboard | `data.counter`, `ai.chat` | none |
| `game.md` | a 2D/3D arcade/clicker with a high-score board | canvas or r3f, `data.counter` | none |
| `poll-charts.md` | a vote/poll/tracker visualized as a live chart | `data.collection`, recharts | none |
| `market.md` | a bet/pot/prediction with **real USDC** staked + payout | `pot`, `payments` | none |
| `predict.md` | a prediction/sweepstakes with bragging rights, **no money** | `data.collection`, `data.counter` | none |
| `judge.md` | an AI-scored contest (drawings/photos against a rubric) | `files.upload`, `ai.chat`, `data` | none |
| `data.md` | an explainer/analysis over an attached/relational dataset | own Neon (Drizzle), `ai.chat` | **Neon** |
| `social.md` | a wall/guestbook/feed of user posts | `data.collection` or own Neon | optional |
| `realtime.md` | a live-updating board / lightweight multiplayer | `data.subscribe` (poll fallback) | none |
| `travel.md` | an AI trip planner / guide shown on a map | `ai.chat`, seeded `<TripMap>`, `data.counter` | none |
| `map.md` | anything that plots places on an interactive map | seeded `<TripMap>` (maplibre-gl) | none |
| `onchain.md` | a game whose state/rewards live **on Arc** (you deploy a contract) | `sdk.onchain` + a Foundry contract | none |

Rules of thumb:
- **Default to platform primitives** (`sdk.data` / `counter` / `pot` / `ai`) — zero-backend,
  faster to deploy. Only reach for an own Neon backend (`data.md`, sometimes `social.md`)
  when the data is relational or needs custom queries the primitives can't express.
- `market` = **real USDC in escrow** (`sdk.pot` + `"payments"` capability); `predict` =
  **no money staked**, just a leaderboard of who called it right. Don't confuse them.
- Compose at most a couple — a "quiz with a chart" reads `quiz.md` + `poll-charts.md`.
- Every recipe's capabilities must appear in the manifest, or the host bridge rejects the
  call (`payments` / `ai` / `social`).
