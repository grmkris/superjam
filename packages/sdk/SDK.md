# SuperJam SDK — how your mini app talks to the platform

You are building ONE screen: a `"use client"` Next.js page. It obtains the `sdk`
by calling `await SuperJam.connect()` (the bridge to SuperJam); `sdk.app.context()`
returns the signed-in player + launch context. Everything is async (a
`postMessage` round-trip to the host). The SDK works identically in the real host
and in **standalone mode** (opened outside SuperJam — methods fall back to an
in-browser mock so the app still runs).

```tsx
"use client";
import { useEffect, useState } from "react";
import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";

export default function Page() {
  const [sdk, setSdk] = useState<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  useEffect(() => {
    // Connect once on mount; ctx comes from the connected sdk.
    SuperJam.connect().then((s) => { setSdk(s); setCtx(s.app.context()); });
  }, []);
  if (!sdk || !ctx) return <main>Loading…</main>;
  // ctx.user.username      — the signed-in player ("kris")
  // ctx.user.walletAddress — their address ("0x…")
  // ctx.user.worldVerified — true if World-ID verified (gate pots on this)
  // ctx.launch             — UNTRUSTED payload from a share link (validate it!)
  // … your app …
}
```

Allowed imports: `react`, `@superjam/sdk` (the **default export** `SuperJam` +
its types), and the curated extras documented in your loaded `skills/*.md`
(`@react-three/fiber`, `@react-three/drei`, `recharts`, `motion`,
`canvas-confetti`, `react-qr-code`, `./lib/sfx`, `./lib/game`). **Nothing else
exists** — never import another package, never `fetch`, never `localStorage`.
The SDK is your only IO.

---

## Which primitive? (pick the right one)

| Need | Use |
|---|---|
| Remember something for THIS user only (settings, progress, drafts) | `sdk.storage` |
| Content ALL users of this app see (walls, posts, votes, moves, galleries) | `sdk.data.collection` |
| A score / vote / tally ranked across users (THE leaderboard) | `sdk.data.counter` |
| Pay/tip USDC (private by default) | `sdk.payments.payUSDC` |
| Check who actually paid (paywalls/unlocks) | `sdk.payments.mine` |
| Notify / invite ONE specific user (tip received, challenge a friend) | `sdk.messages` |
| A shareable deep-link back into this app | `sdk.share.link` |
| Generate text / JSON / judge an image | `sdk.ai.chat` |
| Let the user upload a photo / take a camera shot | `sdk.files.upload` |
| An escrowed group wager (predictions, match pots, sweepstakes) | `sdk.pot` |
| Read/write THIS game's own on-chain Arc contract (the builder deployed it) | `sdk.onchain` |
| A quick host toast | `sdk.ui.toast` |
| 3D, canvas games, charts, animation, generated art | your loaded `skills/*.md` |

---

## sdk.app.context() — who + what launched this (synchronous, already loaded)

```tsx
const ctx = sdk.app.context();
// { appId, slug, name, ensName, category,
//   remixOf: { slug, name } | null,
//   launch: Json | null,     // payload from a share link — UNTRUSTED
//   user: { id, username, walletAddress, worldVerified } }
```
`ctx.launch` is **untrusted input** from whoever opened the link. Validate every
field, render it as plain text, and NEVER auto-trigger a payment from it.

## sdk.storage — PRIVATE, this user only (settings, saves, drafts)

```tsx
const best = await sdk.storage.get<number>("best");      // null if unset; never throws
await sdk.storage.set("best", 42);                        // any JSON value
const many = await sdk.storage.getMany(["a", "b"]);       // { a: …, b: … } — batch RTTs
await sdk.storage.delete("draft");
await sdk.storage.clear();
const { keys } = await sdk.storage.list({ prefix: "save:" });
```

## sdk.data.collection — SHARED, app-public (everyone reads)

```tsx
const wall = sdk.data.collection("wall");
const { id, createdAt } = await wall.insert({ text: "hello!" });  // your fields
const { docs } = await wall.list({ orderBy: { field: "createdAt", dir: "desc" }, limit: 50 });
await wall.update(id, { text: "edited" });   // OWN rows only
await wall.delete(id);                         // OWN rows only
const doc = await wall.get(id);
```
**A Doc is `{ id, userId, username, worldVerified, createdAt, data }`** — identity
is **server-stamped** (you cannot spoof `username`). YOUR fields live under
**`doc.data`** (so read `doc.data.text`, not `doc.text`). Never put secrets in
`data` — every user can read it.

`list` options: `where` = top-level equality only on your data fields, ≤3 keys
(`{ where: { choice: "Pizza" } }`); `orderBy` = `{ field: "createdAt" }` or a
**numeric** data field `{ field: "score", dir: "desc" }` (NULLS LAST);
`limit`, `cursor` for paging (`{ docs, cursor }` → pass `cursor` back).

## sdk.data.counter — atomic tallies & THE leaderboard

```tsx
const scores = sdk.data.counter("scores");
const total = await scores.increment(ctx.user.username, 10);  // atomic upsert, returns new value
const top = await scores.top(10);   // [{ key, value }] — highest first
```
Use a counter for scores, votes, tip totals — **never read-modify-write a doc**
(races). Leaderboard = `counter("scores").top(10)`; highlight the row where
`key === ctx.user.username`. Best-score pattern: keep your own best in
`sdk.storage`, and on a new best `increment` by the delta (or key the counter so
each user's value is their best — increment(username, newBest - oldBest)).

## sdk.payments — USDC (host shows a confirm sheet; you just await)

```tsx
// PRIVATE by default: a shielded transfer. `to` is a @username (defaults to the
// app treasury). NEVER promise the user public/on-chain proof of a tip.
const { hash } = await sdk.payments.payUSDC({ amount: "0.50", to: "kris" });
const bal = await sdk.payments.usdcBalance();   // { formatted: "12.34", raw: "12340000" }
```
**Paywalls / unlocks — the ONLY trustworthy check is `payments.mine`:**
```tsx
const { payments } = await sdk.payments.mine();   // THIS user's confirmed payments in THIS app
const unlocked = payments.length > 0;             // [{ to, amountUsdc, memo, txHash, at }]
```
**Never gate premium content on an `sdk.storage` flag** — the client can set it
without paying. Social visibility of a payment comes only from a `counter` the
payer opts into by tapping (e.g. a tips leaderboard), never from the chain.

`sdk.payments.payX402({ url, maxAmount? })` (GATED — needs "payments"): a private
pay-PER-CALL nanopayment to an HTTP-402 paywalled resource, host-proxied. Use to
UNLOCK a premium resource, **never** to pay a person (that's `payUSDC`).

## sdk.messages — notify / invite ONE user (one-way; for chat, use a collection)

```tsx
// invite pattern: build a deep-link, then notify
const { url } = await sdk.share.link({ data: { matchId } });
await sdk.messages.send({
  to: friend,                                  // a USERNAME — never a wallet
  text: `${ctx.user.username} challenged you! ⚽`,  // ≤280, shows in their inbox
  data: { kind: "challenge", matchId },        // recipient-PRIVATE machine payload
  link: url,                                    // MUST come from sdk.share.link
});
const { messages } = await sdk.messages.list({ limit: 20 });  // sent TO me, newest-first
// Message = { id, from, text, data, link, createdAt, read }
```
Requires manifest capability **"social"**. Send AFTER the triggering action
succeeds, in its OWN try/catch (a failed notify must not look like a failed
payment). Caps: 5/min per (sender,recipient) pair, 20/min per sender. `data` is
recipient-private (good for secret dealing); `text` shows in the inbox (never
put secrets there).

## sdk.share.link — a deep-link back into this app

```tsx
const { url } = await sdk.share.link({ data: { seed } });  // data ≤2KiB JSON
// whoever opens `url` gets `data` as sdk.app.context().launch
```
Render it as a `react-qr-code` (with the `art` skill) or pass to `messages.send`.

## sdk.ai.chat — text / JSON / image judging (SLOW: seconds — always show loading)

```tsx
const { text } = await sdk.ai.chat([
  { role: "system", content: "You are a witty quizmaster. Reply in one sentence." },
  { role: "user", content: "Give a fun fact about the World Cup." },
]);

// force JSON: pass json:true and describe the shape in the prompt; validate it
const { text: raw } = await sdk.ai.chat(
  [{ role: "user", content: 'One trivia Q as {"q":string,"options":string[4],"answer":number}' }],
  { json: true },
);
const quiz = JSON.parse(raw);   // then defensively read quiz.q, quiz.options, …

// JUDGE an image against a rubric YOU state (drawings/outfits/photos):
const up = await sdk.files.upload(dataUrl);
const { text: verdict } = await sdk.ai.chat(
  [{ role: "user", content: "Score this drawing of a cat 0-10 for cuteness; reply 'N — reason'." }],
  { images: [up.url] },   // /f/ URLs or dataURLs, ≤2MB each, ≤4/call
);
```
Quota'd (~25 calls/user/day). Keep prompts short; call on events, **never** in a
render loop or unkeyed `useEffect`; never block first render on it. **AI judging
rule: grade ARTIFACTS against a rubric you state — never identity traits of a
person; wholesome only; always show the score AND the model's one-line reason.**

## sdk.files.upload — user images (jpeg/png/webp/gif ≤2MB)

```tsx
<input type="file" accept="image/*" capture="environment" onChange={(e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    const { url } = await sdk.files.upload(String(r.result));  // full data URL is fine
    setPhoto(url);                                              // <img src={url} />
  };
  r.readAsDataURL(f);
}} />
```
`capture="environment"` opens the camera on phones (getUserMedia does NOT work
in the sandbox). Screenshot/share-card: render to `<canvas>` → `toDataURL` →
`upload`. Server magic-byte sniffs the bytes; downscale phone photos via canvas
if they exceed 2MB.

## sdk.pot — escrowed social wagers (predictions, match pots, sweepstakes)

```tsx
const { id } = await sdk.pot.create({
  question: "Who wins the final?",
  options: ["Argentina", "France"],       // 2–6 strings
  deadline: Date.now() + 3600_000,         // optional (ms epoch)
  resolver: "ai",                          // "creator" (default) | "ai" (auto-resolves from live data)
});
await sdk.pot.stake({ id, option: "Argentina", amount: 2 });   // ≤10 USDC; confirm sheet → escrow
const p = await sdk.pot.get({ id });
// { question, options, totals, myStake, status: "open"|"resolved"|"void", resolvedOption }
await sdk.pot.resolve({ id, option: "Argentina" });   // CREATOR only (must be worldVerified)
```
Creator must be `worldVerified`. `resolver:"ai"` ⇒ at the deadline the PLATFORM
resolves from live data (search-grounded) and auto-pays winners pro-rata + inbox
"you won X USDC 🎉"; the creator can override any time. Unresolved 48h past
deadline ⇒ void = full refunds. Requires capability **"payments"**.

## sdk.onchain — read/write THIS game's own Arc contract (onchain games)

Only for jams the builder deployed a contract for (skill `onchain`, capability
**"onchain"**). The platform resolves YOUR contract by appId — you never pass an
address. Writes are **gasless** (the platform server wallet, the contract's
operator, signs + pays Arc gas) and **player-stamped** (it injects the caller as
the contract fn's first `address player` arg — you pass only the trailing args).

```tsx
// write a move — returns a real tx hash. fn(address player, …yourArgs); pass only yourArgs.
const { hash } = await sdk.onchain.write({ fn: "flip", args: [/* guess */ 1] });

// read a view fn — pass any args yourself (these are NOT stamped).
const [last, won] = await sdk.onchain.read<[string, string]>({
  fn: "statsOf", args: [ctx.user.walletAddress],
});
const wins = BigInt(won);   // big integers come back as decimal STRINGS
```
Writes take seconds (server relays) — show a pending state, then re-`read` the new
state. Wrap in try/catch (`USER_REJECTED`/`BAD_REQUEST`). Gate value-ish or mint
actions on `ctx.user.worldVerified`. In standalone mode reads/writes hit a local
mock (fake hashes) so the app still runs.

## sdk.ui.toast — a quick host-rendered toast

```tsx
sdk.ui.toast("Saved! ✅");   // fire-and-forget, no await needed
```

---

## Patterns from existing primitives (no new surface)

- **Paywall / premium**: gate ONLY on `payments.mine()` (server-verified), never
  a storage flag (spoofable).
- **AI judging**: grade artifacts (drawings/outfits/photos) against a rubric you
  state; show score + one-line reason; never judge people.
- **Secret dealing** (werewolf roles, hidden hands): `messages.send({ to, data })`
  is recipient-private — deal secrets in `data`, NEVER `text` (shows in inbox).
- **Unique draw** (sweepstakes, "pick a team"): `counter("draw").increment(...)`
  is atomic + sequential — index the returned number into your option list for
  collision-free assignment.
- **Commit-reveal** (battleship, simultaneous answers): publish a hash of
  secret+salt to a shared doc at start, reveal at end, peers verify client-side.
- **Invite a friend**: `share.link` → `messages.send({ to, text, link })`.

## Errors — catch, show a friendly message, NEVER retry-loop

Rejections carry a code: `UNAUTHORIZED` · `FORBIDDEN_CAPABILITY` ·
`QUOTA_EXCEEDED` · `USER_REJECTED` (user declined the confirm sheet) ·
`STANDALONE` · `RATE_LIMITED` · `BAD_REQUEST` · `INTERNAL`. In standalone mode
most methods still work against a local mock; payments auto-succeed with a fake
hash. Read `err.code` (or `err.message`) and degrade gracefully.

## Rules

- Edit ONLY `src/app.tsx` (you may add `src/components/*.tsx`). One screen,
  playable instantly, no routing.
- **NEVER use `dangerouslySetInnerHTML`** — shared docs/messages hold other
  users' text; render it as plain React text.
- Refresh lists after your OWN writes (use the returned id/doc to update state).
  If you must poll, poll ≥5s intervals.
- Style with theme.css classes — `tj-card tj-title tj-sub tj-btn tj-btn-ghost
  tj-input tj-row tj-grid2 tj-center tj-list tj-stat tj-badge tj-muted tj-empty
  tj-spin` (+ game classes `tj-stage tj-hud tj-pop tj-shake`, see skills) — plus
  inline styles. Candy accent hexes: `#FF4D6D #FFC940 #2FD180 #4D7CFF`.
- AI/image/pot calls take seconds — always show a loading state; never block
  first render.

---

## Example 1 — tip jar (payUSDC + a tips leaderboard counter)

```tsx
import { useEffect, useState } from "react";
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const [top, setTop] = useState<{ key: string; value: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const tips = sdk.data.counter("tips");

  useEffect(() => { void tips.top(10).then(setTop); }, []);

  async function tip(amount: number) {
    setBusy(true);
    try {
      await sdk.payments.payUSDC({ amount: amount.toFixed(2) });   // → app treasury, private
      await tips.increment(ctx.user.username, amount);             // opt-in social proof
      setTop(await tips.top(10));
      sdk.ui.toast("Thanks for the tip! 💝");
    } catch (e) {
      if ((e as { code?: string }).code !== "USER_REJECTED") sdk.ui.toast("Payment failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Tip Jar 🫙</h1>
      <p className="tj-sub">Send the maker a little love.</p>
      <div className="tj-row">
        {[0.5, 1, 5].map((a) => (
          <button key={a} className="tj-btn" disabled={busy} onClick={() => tip(a)}>${a}</button>
        ))}
      </div>
      <ul className="tj-list">
        {top.map((r) => (
          <li key={r.key} style={r.key === ctx.user.username ? { color: "var(--accent)" } : undefined}>
            <b>@{r.key}</b> <span className="tj-muted">${r.value.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Example 2 — guestbook (the canonical shared-collection loop)

```tsx
import { useEffect, useState } from "react";
import type { SuperJamSdk, AppContext, Doc } from "@superjam/sdk";

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [draft, setDraft] = useState("");
  const wall = sdk.data.collection("entries");

  useEffect(() => { void wall.list({ orderBy: { field: "createdAt", dir: "desc" } }).then((r) => setDocs(r.docs)); }, []);

  async function sign() {
    const text = draft.trim(); if (!text) return;
    const { id, createdAt } = await wall.insert({ text });
    setDocs([{ id, createdAt, userId: ctx.user.id, username: ctx.user.username,
               worldVerified: ctx.user.worldVerified, data: { text } }, ...docs]);
    setDraft("");
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Guestbook ✍️</h1>
      <div className="tj-row">
        <input className="tj-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Say hi…" />
        <button className="tj-btn" onClick={sign}>Sign</button>
      </div>
      <ul className="tj-list">
        {docs.map((d) => (
          <li key={d.id}>
            <b>@{d.username}</b> {String(d.data.text)}
            {d.username === ctx.user.username && (
              <button className="tj-btn tj-btn-ghost" style={{ marginLeft: "auto", padding: "2px 8px" }}
                onClick={() => { void wall.delete(d.id); setDocs(docs.filter((x) => x.id !== d.id)); }}>✕</button>
            )}
          </li>
        ))}
        {docs.length === 0 && <div className="tj-empty">No entries yet — be the first!</div>}
      </ul>
    </div>
  );
}
```

---

## Bridge result contract (host adapter — Opus A)

> Not for mini-app authors. This pins the exact `result` the host's
> postMessage→oRPC adapter must put on each §8 reply envelope, so `@superjam/sdk`
> and the host never drift. The SDK also defensively normalizes the ⚠️ items
> (see `toMs`/`unwrapNum` in `src/index.ts`), but the adapter should emit these
> shapes directly. **postMessage uses structured clone — a `Date` survives as a
> `Date`, NOT an ISO string — so timestamps MUST be converted explicitly.**

- **All timestamps are epoch-ms `number`** — `.getTime()` every `Date` before
  replying: `Doc.createdAt`, `data.insert → createdAt`, `Payment.at`,
  `Message.createdAt`. ⚠️ the services currently emit `Date`.
- **`counter.increment` → bare `number`** (not `{ value }`). ⚠️ `bridge.ts`
  returns `{ value }`; the adapter must unwrap.
- `Doc = { id:string, userId:string, username:string, worldVerified:boolean, createdAt:number, data:Record<string,Json> }`
  — identity server-stamped; the app's fields are nested under `data`.

| method | `result` shape |
|---|---|
| `host.hello` / `app.context` | `AppContext` (`{ appId, slug, name, ensName, category, remixOf, launch, user:{ id, username, walletAddress, worldVerified } }`) |
| `wallet.getAddress` | `string` (`0x…`) |
| `wallet.sendTransaction` | `{ hash: string }` |
| `payments.payUSDC` | `{ hash: string }` |
| `payments.usdcBalance` | `{ formatted: string, raw: string }` |
| `payments.mine` | `{ payments: Payment[] }`, `Payment = { to, amountUsdc(string), memo:string\|null, txHash, at(number) }` |
| `payments.payX402` | `{ paid: boolean, result?: Json }` |
| `storage.get` | `Json \| null` |
| `storage.getMany` | `Record<string, Json\|null>` |
| `storage.set` / `delete` / `clear` | `null` (void) |
| `storage.list` | `{ keys: string[], cursor?: string }` |
| `data.insert` | `{ id: string, createdAt: number }` |
| `data.get` | `Doc \| null` |
| `data.update` / `delete` | `null` (void) |
| `data.list` | `{ docs: Doc[], cursor?: string }` |
| `counter.increment` | `number` |
| `counter.top` | `{ key: string, value: number }[]` |
| `ai.chat` | `{ text: string }` |
| `messages.send` | `{ id: string }` |
| `messages.list` | `{ messages: Message[] }`, `Message = { id, from, text, data:Json\|null, link:string\|null, createdAt(number), read }` |
| `share.link` | `{ url: string }` |
| `files.upload` | `{ id: string, url: string }` (request param is `{ dataBase64 }` — the SDK strips the data-URL prefix) |
| `pot.create` | `{ id: string }` |
| `pot.stake` | `{ txHash: string }` |
| `pot.get` | `Pot = { question, options:string[], totals:Record<string,string>, myStake:{option,amount}\|null, status:"open"\|"resolved"\|"void", resolvedOption:string\|null }` |
| `pot.resolve` | `null` (void) |
| `onchain.read` | the decoded view result (bigints stringified; tuples as arrays). Params `{ fn, args }` — `appId` host-injected, the contract resolved server-side |
| `onchain.write` | `{ hash: string }`. Params `{ fn, args }` — the server prepends the verified player as the contract fn's first arg |
| `ui.toast` | `null` (fire-and-forget) |

Request params per method are defined by `makeBridgeSdk` in `src/index.ts`; the
host injects the trusted `appId` from its `Window→app` map (§8) — the iframe
never sends it. Errors reply `{ ok:false, error:{ code, message } }` with a §8
`TJErrorCode`.
