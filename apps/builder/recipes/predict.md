# Recipe predict — predictions / sweepstakes with bragging rights (zero-backend, NO money)

Everyone calls an outcome; when it resolves, a leaderboard shows who got it right. **No escrow,
no confirm sheet, no `"payments"` capability** — the low-friction complement to `market.md`
(a judge can play instantly with zero USDC). Capability: none (or `"ai"` if AI-resolved).

## RULES
1. One pick per user → `sdk.data.collection("picks").insert({ option })`; show live tallies.
2. Resolve: the creator (gate on `worldVerified`) picks the winning option, **or** AI resolves
   (`sdk.ai.chat`, grounded question). Then award everyone who picked it:
   `sdk.data.counter("correct").increment(username, 1)`.
3. Show the all-time `counter("correct").top(10)` board — that's the bragging right.

## Pattern (sketch)
```tsx
// pick: await sdk.data.collection("picks").insert({ option });
// tally: reduce collection("picks").list() by data.option
// resolve (creator): for each pick where data.option === winner,
//   await sdk.data.counter("correct").increment(pick.username, 1)
// board: await sdk.data.counter("correct").top(10)
```
Structure the screen like `quiz.md` (options → result → leaderboard); the only difference is
the outcome is a future real-world event a host/AI resolves, not a known answer.

## Variants
- **AI-resolved** — at/after the deadline call `sdk.ai.chat` with a grounded question to pick
  the winner; capability `"ai"`.
- **Sweepstakes** — assign each entrant a random option via `counter("draw").increment` (atomic,
  collision-free) instead of letting them choose.
