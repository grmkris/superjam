# Recipe data — dataset explainer / analysis (OWN Neon backend)

The one archetype that uses the app's **own database**. Ingest a dataset (CSV/JSON upload, or
seeded rows), store it in **Neon** via Drizzle, expose it through the app's own API routes
(JWT-verified), then chart + **narrate it with `sdk.ai.chat`**. Manifest capability: **"ai"**.
This is the only recipe that goes through `app/api/*` + `lib/schema.ts` — follow
`apps/example-app` exactly for the backend shape.

## Backend (own Neon — see `apps/example-app`)
- `lib/schema.ts` — Drizzle tables for the dataset (the scaffold seeds these from `spec.data`).
- `app/api/rows/route.ts` — `GET` public (list rows), `POST` calls `userFromRequest(req)`
  (from `lib/superjam.ts` — **do not rewrite it**) and stamps identity from the verified token,
  never the body. Reads/writes via `lib/db.ts`.

## Client (`app/page.tsx`)
- Attach identity to your own backend:
  `const { token } = await sdk.auth.getToken(); fetch("/api/rows", { headers:{ authorization:`Bearer ${token}` }})`.
- Parse an uploaded CSV client-side (tiny hand-rolled split, or add `"papaparse"` to deps),
  POST rows, then summarize columns (count/min/max/mean) and render **inline SVG bars** (no
  deps). Then one short `sdk.ai.chat` call over the SUMMARY (not raw rows) for a plain-language
  read; show a spinner, degrade silently on failure.

## RULES
1. No remote `fetch` of third-party data — the user supplies the file, or it's seeded at build.
2. Pass the column **summary** to `ai.chat`, never the whole dataset (keep the prompt tiny).
3. Empty/malformed file → render nothing rather than crash.

## When NOT to use this recipe
If the app is really a leaderboard/poll/feed, use the zero-backend primitives (`poll-charts`,
`social`) instead — own-Neon is only for relational/custom-queried data.
