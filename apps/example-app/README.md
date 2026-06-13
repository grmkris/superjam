# Guestbook — a SuperJam external mini-app (reference template)

The reference **Track-B** SuperJam app: a normal **Next.js (App Router)** app you
**host yourself** (Vercel), with its **own database** (Neon), that talks to the
SuperJam platform only through **`@superjam/sdk`**. This is the template a
SuperJam builder generates and deploys; you can also fork it by hand.

The platform hosts nothing here — it provides identity, the capability bridge
(payments/ai/messages/…), distribution (ENS/marketplace), and payments. Your
app brings the rest.

## How identity works (no cookies, no shared secret)

1. The app runs in a SuperJam iframe and calls `SuperJam.connect()` (client).
2. `sdk.auth.getToken()` returns a short-lived, ES256-signed token from the
   platform, bound to **this app's id** (`aud`).
3. The client sends it `Authorization: Bearer` to **this app's own** API routes.
4. The backend verifies it against SuperJam's **published JWKS**
   (`lib/superjam.ts` → `userFromRequest`) — `iss` + `aud` checked, so a token
   for another app is rejected. A leaked env exposes nothing (the keys are
   public; identity can't be forged).

`app/api/me/route.ts` and `app/api/entries/route.ts` show the pattern; identity
columns are **stamped from the verified token, never from the client**.

## Run locally

```bash
bun install
cp .env.example .env.local      # fill SUPERJAM_APP_ID etc.; DATABASE_URL optional
bun run dev                     # standalone mode (SDK mock) until framed by SuperJam
```

Without `DATABASE_URL` the app uses an in-memory store, so it runs with zero
infra. Add a Neon URL to persist:

```bash
# create a Neon project, then:
DATABASE_URL=postgres://…  bunx drizzle-kit push   # creates the `entries` table
```

## Deploy to Vercel

```bash
vercel deploy --prod
```

Set env vars on the Vercel project (the builder does this automatically):
`SUPERJAM_JWKS_URL`, `SUPERJAM_ISSUER`, `SUPERJAM_APP_ID`, `DATABASE_URL` (the
pooled Neon connection string), and `SUPERJAM_FRAME_ANCESTORS`.

The app already ships the required framing header
(`Content-Security-Policy: frame-ancestors …` in `next.config.ts`, and **no**
`X-Frame-Options`) so the SuperJam host can iframe it.

## Register with SuperJam

The app serves its manifest at `/.well-known/superjam.json`. A builder calls
`apps.registerExternal({ manifest, entryUrl })`; a hand-built app can register
its deployed URL the same way from the dev portal.
