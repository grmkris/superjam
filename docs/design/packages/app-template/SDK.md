# TurboJam SDK — how your mini app talks to the platform

Your component receives everything as props. NEVER import anything except
react and types from `./sdk`:

```tsx
import type { TJSdk } from "./sdk";

export default function App({ ctx, sdk }: { ctx: { username: string; wallet: string }; sdk: TJSdk }) {
  // ctx.username — the signed-in player ("kris")
  // ctx.wallet   — their wallet address ("0x…")
}
```

## Which primitive? (pick the right one)

| Need | Use |
|---|---|
| Remember something for THIS user only (settings, progress, bests) | `sdk.storage` |
| Content ALL users see (message wall, guestbook, posts, game moves) | `sdk.data` |
| Scores ranked across users | `sdk.leaderboard` |
| Notify / invite a SPECIFIC user (tip received, challenge a friend) | `sdk.messages` |
| The user's friends | `sdk.social` |
| Payments | `sdk.wallet` |
| Generate text / JSON / decide which app function to run | `sdk.ai` |
| Generate an image from a prompt | `sdk.ai.image` |
| Let the user upload a photo/image | `sdk.files` |

All sdk methods are async. The SDK works identically in the real host and standalone.

## sdk.storage — PRIVATE, this user only

```tsx
const saved = await sdk.storage.get<number>("best-score");   // null if unset
await sdk.storage.set("best-score", 42);                      // any JSON value
```

## sdk.data — SHARED collections, everyone sees them

```tsx
const doc = await sdk.data.insert("wall", { text: "hello!" }); // returns the stamped doc
const docs = await sdk.data.list("wall", 50);                  // newest-first
await sdk.data.remove("wall", doc.id);                          // only YOUR docs
```
Name any collection you like (`"wall"`, `"posts"`, `"moves"` — lowercase). The
server stamps every doc with reserved keys `id`, `by` (author username), `at`
(ms timestamp) — never set those yourself. Docs ≤2KB, plain objects only.
Show a delete button only when `doc.by === ctx.username`.

## sdk.leaderboard — shared scores (keeps each user's BEST)

```tsx
await sdk.leaderboard.submit(score);
const top = await sdk.leaderboard.top(10);    // [{username, score, at}] best-first
```
Games: submit on game-over, show the top list, highlight
`entry.username === ctx.username`.

## sdk.messages — notify/invite a specific user (one-way; for chat use sdk.data)

```tsx
const msg = await sdk.messages.send({
  to: friend.username,          // a USERNAME — never a wallet address
  text: "kris tipped your jar 0.5 USDC 🎉",
  data: { kind: "tip", amount: 0.5 },   // optional payload for YOUR app to read
});
const mine = await sdk.messages.list(20); // messages sent TO ME via this app, newest-first
```
The recipient also sees `text` in their TurboJam inbox. Use `data` for
machine-readable payloads (challenge seeds, invites) — your app reads it back
via `list()` on the recipient's side.

## sdk.social — the player's friends

```tsx
const friends = await sdk.social.friends();   // [{username, wallet}] — may be empty, render a fallback
```

## sdk.wallet — payments (host shows a confirm sheet; you just await)

```tsx
try {
  const { txHash } = await sdk.wallet.sendTransaction({
    to: friend.wallet, amountUsdc: 0.5, memo: "great game!",   // max 25 USDC
  });
} catch (e) { /* "USER_REJECTED" — handle gracefully, never retry */ }
```

## sdk.ai — AI calls (SLOW: 4-15s — always show a loading state)

```tsx
const story = await sdk.ai.text("a 2-sentence pirate story about " + topic);

const quiz = await sdk.ai.json<{ q: string; options: string[]; answerIndex: number }>(
  "one multiple-choice trivia question about space",
  "{ q: string, options: string[4], answerIndex: number }"   // shapeHint
);

const img = await sdk.ai.image("a cozy pixel-art lighthouse at dusk");
// <img src={img.url} /> — renders directly

const r = await sdk.ai.tools("user said: " + input, [
  { name: "addTodo", description: "add a todo item", params: { text: "string" } },
  { name: "clearAll", description: "clear the list", params: {} },
]);
for (const call of r.toolCalls) {           // ALWAYS an array (maybe empty)
  if (call.name === "addTodo") addTodo(String(call.args.text));
  if (call.name === "clearAll") clearAll();
}
```
- Every call takes seconds and is quota-limited (~25/day per user) — call on
  button clicks / game events, NEVER in a render loop or unkeyed useEffect.
- `tools` is one-shot and stateless: to "loop", put the previous results into
  the next prompt yourself. Keep it to 1-2 iterations.
- `json`: validate/default the fields you read — the shape is best-effort.

## sdk.files — user image uploads (PUBLIC by URL once uploaded)

```tsx
<input type="file" accept="image/*" onChange={(e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const { url } = await sdk.files.upload(String(reader.result)); // full data URL is fine
    setPhotoUrl(url);                                              // <img src={url} />
  };
  reader.readAsDataURL(f);
}} />
```
jpeg/png/webp/gif only, ≤2MB (phone photos may exceed this — downscale via
canvas first if quality allows). Plain `<input type=file>` works; fancy
pickers/camera APIs do NOT in the sandbox.

## Errors (catch, show a friendly message, NEVER retry-loop)

`USER_REJECTED` · `RATE_LIMITED` · `STORAGE_QUOTA` · `DOC_NOT_OBJECT` ·
`DOC_TOO_LARGE` · `TO_MUST_BE_USERNAME` · `QUOTA_EXCEEDED` · `FILE_TOO_LARGE`
· `BAD_FILE_TYPE` · `IMAGE_BUSY` · `AI_BUSY` · `IMAGE_GEN_NOT_CONFIGURED` ·
`BAD_PARAMS: …`

## Rules

- Edit ONLY `src/app.tsx`. React hooks allowed. No network calls (fetch/ws) —
  the SDK is your only IO. No localStorage — use sdk.storage.
- **NEVER use dangerouslySetInnerHTML** — shared docs/messages contain other
  users' text; render it as plain React text.
- Refresh lists after your OWN writes (use the returned stamped doc to update
  state). If you must poll, poll ≥5s intervals.
- Style with theme.css classes: `tj-card tj-title tj-sub tj-btn tj-input
  tj-row tj-list tj-stat tj-muted` + inline styles. One screen, playable
  instantly, no routing.

## Example 1 — guestbook (shared wall, the canonical sdk.data loop)

```tsx
import { useEffect, useState } from "react";
import type { TJDoc, TJSdk } from "./sdk";

export default function App({ ctx, sdk }: { ctx: { username: string; wallet: string }; sdk: TJSdk }) {
  const [docs, setDocs] = useState<TJDoc[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => { void sdk.data.list("wall").then(setDocs); }, [sdk]);

  async function post() {
    if (!draft.trim()) return;
    const doc = await sdk.data.insert("wall", { text: draft.trim() });
    setDocs([doc, ...docs]);          // optimistic prepend of the STAMPED doc
    setDraft("");
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Guestbook</h1>
      <div className="tj-row">
        <input className="tj-input" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="tj-btn" onClick={post}>Sign</button>
      </div>
      <ul className="tj-list">
        {docs.map((d) => (
          <li key={d.id}>
            <b>@{d.by}</b> {String(d.text)}
            {d.by === ctx.username && (
              <button className="tj-muted" onClick={() => {
                void sdk.data.remove("wall", d.id);
                setDocs(docs.filter((x) => x.id !== d.id));
              }}>✕</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Example 2 — tip + notify (payment first, message in its OWN try/catch)

```tsx
async function tip(friend: { username: string; wallet: string }) {
  const { txHash } = await sdk.wallet.sendTransaction({
    to: friend.wallet, amountUsdc: 1, memo: "for you!",
  }); // throws USER_REJECTED if declined — stop here
  try {
    await sdk.messages.send({
      to: friend.username,
      text: `${ctx.username} tipped you 1 USDC 💝`,
      data: { kind: "tip", txHash },
    });
  } catch { /* notification failing must not look like a payment failure */ }
}
```
