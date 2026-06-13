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
