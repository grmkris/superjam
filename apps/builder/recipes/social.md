# Recipe social — walls / guestbooks / feeds

Shared user posts. **Default: zero-backend** via `sdk.data.collection("posts")` — identity is
server-stamped, no DB to run. Reach for an own Neon backend (the `apps/example-app` pattern:
`app/api/entries` + `lib/schema.ts`) only if posts need relational queries. Add the **"social"**
capability ONLY when you notify a specific user with `sdk.messages.send`.

## Pattern — `app/page.tsx` (zero-backend)
```tsx
"use client";
import SuperJam, { type SuperJamSdk, type Doc } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [me, setMe] = useState("");
  const [posts, setPosts] = useState<Doc[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => { (async () => {
    const sdk = await SuperJam.connect(); sdkRef.current = sdk;
    setMe(sdk.app.context().user.username);
    setPosts((await sdk.data.collection("posts").list({ orderBy: { field: "createdAt", dir: "desc" } })).docs);
  })(); }, []);

  async function post() {
    const sdk = sdkRef.current; const text = draft.trim();
    if (!sdk || !text) return;
    await sdk.data.collection("posts").insert({ text });
    setPosts((await sdk.data.collection("posts").list({ orderBy: { field: "createdAt", dir: "desc" } })).docs);
    setDraft("");
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 24 }}>
      <h1>✍️ Wall</h1>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={280} placeholder="Say hi…" />
      <button onClick={post}>Post</button>
      <ul>{posts.map((p) => (
        <li key={p.id}><b>@{p.username}</b>{p.worldVerified ? " ✅" : ""}: {String(p.data.text)}</li>
      ))}</ul>
    </main>
  );
}
```

## RULES
1. Render post text as plain React text — never `dangerouslySetInnerHTML`.
2. `update`/`delete` work on OWN rows only — show the ✕ only on `p.username === me`.
3. Invite/notify a friend (`"social"`): `sdk.share.link()` → `sdk.messages.send({ to, text, link })`.
