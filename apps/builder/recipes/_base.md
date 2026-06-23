# Recipe _base — the external SuperJam app contract (read this first)

You are generating a **standalone Next.js 16 (app-router) app** that SuperJam deploys to
Vercel and frames cross-origin in a sandboxed iframe. It talks to the SuperJam host through
`@superjam/sdk` over a postMessage bridge, and — if it stores its own data — to **its own
Neon database** via its own API routes. The reference implementation is `apps/example-app`;
imitate its shape.

## File layout (what you write vs what is fixed)

```
app/page.tsx                       ← YOU WRITE: the whole UI + SDK usage + app logic
app/api/<feature>/route.ts         ← YOU WRITE (only if the app has its own backend data)
lib/schema.ts                      ← YOU EXTEND: Drizzle tables (seeded from the spec)
app/layout.tsx                     ← minimal, usually leave as-is
lib/superjam.ts                    ← FIXED boilerplate — JWKS verify. NEVER rewrite it.
lib/db.ts                          ← FIXED boilerplate — Neon connection. NEVER rewrite it.
next.config.ts                     ← FIXED — CSP frame-ancestors for the SuperJam embed.
app/.well-known/superjam.json/...  ← FIXED — serves the manifest.
package.json                       ← FIXED — deps are pinned by the generator.
```

**Only `app/page.tsx`, the `app/api/*` routes, and `lib/schema.ts` are yours.** The auth,
db, config, and manifest files are generated deterministically and correctly — do not touch
them.

## 1. The client (`app/page.tsx`) — always `"use client"`

```tsx
"use client";
import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  useEffect(() => {
    (async () => {
      const sdk = await SuperJam.connect();   // resolves even standalone (mock)
      sdkRef.current = sdk;
      // sdk.standalone === true when opened outside SuperJam → degrade gracefully
    })();
  }, []);
  // ...
}
```
- `SuperJam.connect()` is the **default export** + the typed `SuperJamSdk`. It never throws;
  outside the host it returns a standalone mock — gate write/identity UI on `sdk.standalone`.
- The SDK surface (`sdk.data`, `sdk.data.counter`, `sdk.ai.chat`, `sdk.payments`,
  `sdk.messages`, `sdk.share`, `sdk.pot`, `sdk.ui.toast`, `sdk.storage`,
  `sdk.app.context()`) is documented in `@superjam/sdk`'s `SDK.md` — **use it verbatim**;
  it is unchanged from the platform docs.

## 2. Two data paths — pick the lighter one

- **Platform primitives (default, zero-backend):** for shared lists, leaderboards, votes,
  wagers, AI — use `sdk.data.collection(name)`, `sdk.data.counter(name).top()`,
  `sdk.pot.*`, `sdk.ai.chat`. The platform stores it; identity is server-stamped; **no API
  route, no Neon, no `lib/schema.ts`.** Most archetypes (quiz, game, poll, market) live here.
- **Own backend (Neon), only when the app needs relational / custom-queried data the
  primitives can't express:** write `app/api/<feature>/route.ts` that calls
  `userFromRequest(req)` (from `lib/superjam.ts`) and reads/writes Drizzle tables in
  `lib/schema.ts` via `lib/db.ts`. The client attaches identity with:
  ```tsx
  const { token } = await sdk.auth.getToken();      // short-lived; re-fetch each call
  await fetch("/api/things", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload) });
  ```
  The route **stamps identity from the verified token, never from the body** (see
  `apps/example-app/app/api/entries/route.ts`).

> The deterministic scaffold maps `spec.data.collections` → Neon Drizzle tables. If the
> archetype is really a leaderboard/vote/wager, prefer the platform primitive instead and
> leave the backend unused — simpler and faster. (Boundary note for the generator: a spec
> that only needs a counter should NOT force a Neon project.)

## Look & feel — the Toybox theme (use it, don't reinvent)
The app already ships the SuperJam **Toybox** theme — `app/theme.css` (the LOCKED design
system, imported in `app/layout.tsx`) with the design tokens + the **Baloo 2** font, so a
framed jam looks native in the host. **Use its classes instead of ad-hoc `system-ui`
inline styles. DO NOT edit `theme.css`** — put any custom CSS in `app/globals.css`.
- Wrap your screen in `<main className="tj-app">` (a mobile-first column).
- Own your FIRST screen: lead with `tj-hero` (the first child of `tj-app` so it bleeds
  full-width) — a candy-gradient band with a hook line / call-to-action, NOT the jam's
  name (the host bar shows that). Override its gradient with an inline `style` or a baked
  `<img src="/hero.png">` for per-jam art, so each jam opens distinct instead of a bare card.
- Surfaces & layout: `tj-card` (white, ink border, sticker shadow), `tj-header` (a row:
  `tj-emoji` chip + `tj-htext` holding `tj-title`/`tj-sub`, optional `tj-spacer`),
  `tj-row`, `tj-grid2`, `tj-center`, `tj-list`, `tj-muted`.
- Controls: `tj-btn` (+ `tj-btn-ghost`/`tj-btn-yellow`/`tj-btn-green`/`tj-btn-blue`/
  `tj-btn-block`), `tj-input`. Pickers: `tj-choices` (+ `tj-cols-2`) of `tj-choice`
  buttons with `aria-pressed={selected}`. Meters: `tj-bar` > `tj-bar-fill`
  (`style={{ width: \`\${pct}%\` }}`) + optional `tj-bar-label`.
- Bits: `tj-stat` (big number), `tj-badge`/`tj-pill` (chips), `tj-empty` (empty state),
  `tj-spin` (loader), `tj-pop`/`tj-shake` (juice). Full-bleed games: `tj-stage`+`tj-hud`.
- Colors come from CSS vars — `var(--accent)` pink, `var(--yellow)`, `var(--green)`,
  `var(--blue)`, `var(--text)` ink, `var(--bg)` cream, `var(--card)`, `var(--muted)`.
- The PAGE stays cream + ink: NEVER set a dark page/body/`tj-app` background or dark-on-dark
  text. A vivid `tj-hero` band with light-on-color text is encouraged; a dark *page* is not.
  Do NOT set `fontFamily: "system-ui"` or re-declare fonts — Baloo 2 is the body font.
  Inline styles are fine for layout (flex/grid/spacing); pull color/font/buttons/cards
  from the theme so every jam shares the host's visual language.

## HARD RULES
1. `app/page.tsx` starts with `"use client"`. One screen, playable instantly, no routing.
2. NEVER trust a client-supplied user id — in API routes, take identity ONLY from
   `userFromRequest(req)`. NEVER rewrite `lib/superjam.ts`.
3. Render all user/AI text as plain React text — never `dangerouslySetInnerHTML`.
4. `sdk.ai.chat` is slow + quota'd and can return junk — always parse defensively and ship a
   local fallback; never block first render on it.
5. Standalone-safe: when `sdk.standalone`, show a "open inside SuperJam to sign in" state
   instead of erroring.
6. Match the spec's `acceptance` list — implement until every item holds.
