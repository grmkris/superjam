// guestbook — a use-case kit for shared walls / guestbooks / message boards /
// confession walls / feeds: a single shared stream of short posts everyone sees,
// backed by sdk.data.collection (zero backend, identity server-stamped). The kit
// hand-holds the cheap build model: a tailored match, clarifying questions, a
// FILLED plan, a near-complete starter app/page.tsx with a few cosmetic gaps, and
// a gate that rejects an unfilled stub.
//
// SDK CONTRACT — same self-connect reconciliation as tap-arcade (NOT SDK.md's
// `App({ sdk, ctx })` prop signature, which doesn't match what mounts/compiles):
//   import SuperJam, { type SuperJamSdk, type AppContext, type Doc } from "@superjam/sdk";
//   const sdk = await SuperJam.connect();   // inside a useEffect
//   const ctx = sdk.app.context();          // synchronous, after connect
// Collection surface (per SDK.md): `const wall = sdk.data.collection("name")`;
// `wall.insert({ ...fields }) → { id, createdAt }`; `wall.list({ orderBy, limit })
// → { docs }`. A Doc is `{ id, userId, username, worldVerified, createdAt, data }`
// — identity is SERVER-STAMPED (you cannot spoof `username`) and YOUR fields live
// under `doc.data` (read `doc.data.text`, not `doc.text`). Render all user text as
// PLAIN React text — NEVER dangerouslySetInnerHTML.
import type { AppSpec } from "@superjam/shared";
import type { GateResult, Kit, KitContext } from "./types.ts";

// Mirrors selectRecipes' keyword heuristic: category=social OR the name/description/
// features read like a guestbook/wall/board/feed/confession/shoutbox.
const WALL_RE =
  /guestbook|wall|message board|confession|feed|post|shout|board|leave a (message|note)|comments?/i;

const match = (spec: AppSpec): boolean => {
  if (spec.category === "social") return true;
  const hay = `${spec.name} ${spec.description} ${spec.features.join(" ")}`;
  return WALL_RE.test(hay);
};

const questions: Kit["questions"] = [
  {
    q: "What do people post?",
    options: ["Short text messages", "Text + an emoji/reaction", "A photo with a caption", "One-line shoutouts"],
  },
  {
    q: "Who's behind each post?",
    options: ["Show the username (signed wall)", "Anonymous (hide who posted)", "Let the poster choose per post"],
  },
  {
    q: "How is the feed ordered & kept clean?",
    options: ["Newest first", "Oldest first (chronological)", "Newest first + a length cap per post", "Pinned welcome note on top"],
  },
];

// Pick the spec's first declared collection name so the plan + starter wire the
// EXACT key the spec promised; fall back to a sensible wall default.
const collectionName = (spec: AppSpec): string => spec.data.collections[0]?.name ?? "posts";

const plan = (spec: AppSpec): string => {
  const emoji = spec.iconEmoji;
  const coll = collectionName(spec);
  const feats = spec.features.length
    ? spec.features.map((f) => `   - ${f}`).join("\n")
    : "   - (no extra features declared — keep it a tight post + feed loop)";
  return `# Build plan — ${emoji} ${spec.name} (shared wall / guestbook / feed)

1. Connect on mount: \`const sdk = await SuperJam.connect()\` inside a useEffect,
   then \`sdk.app.context()\` for the current user. Show a loading state until ready.
2. Load the shared feed newest-first from
   \`sdk.data.collection("${coll}").list({ orderBy: { field: "createdAt", dir: "desc" }, limit: 50 })\`
   and keep the returned \`docs\` in React state.
3. Render a compose box (a text input/textarea + a Post button) at the top, then
   the shared feed below it.
4. On submit/post: trim the draft, bail on empty, then
   \`sdk.data.collection("${coll}").insert({ text })\`. NEVER pass a client user id —
   identity is server-stamped (the \`username\` on each Doc comes from the server,
   not your form). Clear the draft after a successful insert.
5. Optimistic UX: prepend the new post to local state immediately, then re-list to
   reconcile with the server's authoritative ordering + stamped identity.
6. Render EVERY post's text as PLAIN React text (\`{String(post.data.text)}\`) —
   NEVER \`dangerouslySetInnerHTML\` (these are untrusted user strings). Read fields
   from \`post.data.*\`, show \`@{post.username}\`, and an empty-state when there are
   no posts yet.
7. Wire the spec's specifics:
${feats}
8. Acceptance: posting adds a row everyone can see, the feed shows newest-first
   with the server-stamped username, and user text renders as inert plain text.`;
};

// A near-complete, TYPE-CORRECT starter. It compiles as-is (the gaps are visual /
// styling polish, not type or logic holes) and follows the self-connect pattern
// proven by the known-good builds + tap-arcade. The model fills the `// TODO:` gaps.
const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const coll = collectionName(spec);
  const page = `"use client";

import SuperJam, { type SuperJamSdk, type AppContext, type Doc } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

// ${title} — a shared wall. Posts live in sdk.data.collection("${coll}"); identity
// is server-stamped (post.username) and your fields live under post.data.
export default function Page() {
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [posts, setPosts] = useState<Doc[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const sdkRef = useRef<SuperJamSdk | null>(null);

  // Connect once, then load the shared feed newest-first (self-connect pattern).
  useEffect(() => {
    (async () => {
      const sdk = await SuperJam.connect();
      sdkRef.current = sdk;
      setCtx(sdk.app.context());
      const { docs } = await sdk.data
        .collection("${coll}")
        .list({ orderBy: { field: "createdAt", dir: "desc" }, limit: 50 });
      setPosts(docs);
      setLoading(false);
    })();
  }, []);

  async function refresh() {
    const sdk = sdkRef.current;
    if (!sdk) return;
    const { docs } = await sdk.data
      .collection("${coll}")
      .list({ orderBy: { field: "createdAt", dir: "desc" }, limit: 50 });
    setPosts(docs);
  }

  async function post() {
    const sdk = sdkRef.current;
    const text = draft.trim();
    if (!sdk || !ctx || !text || posting) return;
    setPosting(true);
    // Optimistic prepend — instant feedback. The id/createdAt/username are
    // provisional; refresh() reconciles with the server-stamped authoritative row.
    const optimistic: Doc = {
      id: \`tmp-\${Date.now()}\`,
      userId: ctx.user.id,
      username: ctx.user.username,
      worldVerified: ctx.user.worldVerified ?? false,
      createdAt: Date.now(),
      data: { text },
    };
    setPosts((prev) => [optimistic, ...prev]);
    setDraft("");
    // NEVER pass a client user id — identity is server-stamped on insert.
    await sdk.data.collection("${coll}").insert({ text });
    await refresh();
    setPosting(false);
  }

  if (loading) {
    return (
      <main className="tj-app tj-center">
        <div className="tj-card">
          <div className="tj-spin" />
          <p className="tj-sub">Loading ${title}…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="tj-app tj-stagger">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${emoji}</span>
          <div className="tj-htext">
            <h1 className="tj-title">${title}</h1>
            <p className="tj-sub">Leave a message for everyone to see.</p>
          </div>
        </div>

        <textarea
          className="tj-input"
          value={draft}
          maxLength={280}
          placeholder="Say something…"
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="tj-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
          {/* TODO: make the counter turn accent-colored as it nears the 280 cap. */}
          <span className="tj-muted">{draft.length}/280</span>
          <button className="tj-btn" onClick={post} disabled={posting || !draft.trim()}>
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>

      <div className="tj-card">
        <h2 className="tj-title" style={{ fontSize: 18, marginBottom: 4 }}>The wall 📝</h2>
        <ul className="tj-list">
          {posts.map((p) => (
            <li
              key={p.id}
              style={{ flexDirection: "column", alignItems: "stretch", gap: 2, border: "2px solid var(--text)", borderRadius: 12, padding: "10px 12px", background: "var(--bg)" }}
            >
              {/* TODO: add an avatar/emoji bubble per author (e.g. derive from p.username). */}
              <span style={{ fontWeight: 800 }}>@{p.username}{p.worldVerified ? " ✅" : ""}</span>
              {/* Render user text as PLAIN text — never dangerouslySetInnerHTML. */}
              <span>{String(p.data.text)}</span>
            </li>
          ))}
          {posts.length === 0 && (
            <li className="tj-empty">No posts yet — be the first to write on the wall!</li>
          )}
        </ul>
        {/* TODO: relative timestamps (e.g. "2m ago" from p.createdAt). */}
      </div>
    </main>
  );
}
`;
  return { "app/page.tsx": page };
};

// Kit gate — runs ALONGSIDE the generic gate (which already checks @superjam/sdk
// usage, "use client", interactivity, and no leftover TODO). Here we add the
// wall-specific FUNCTIONAL probes so a model can't pass by writing a non-wall.
const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  // Use-case core only (generic gate covers not-stub + sdk import + interactivity).
  // Match the METHOD CHAIN, not an `sdk.` prefix (the sdk var can be named anything).
  if (!/\.data\.collection\(/.test(page)) {
    missing.push('use data.collection("...").insert/list for the SHARED wall of posts');
  }
  // SAFETY (keep): untrusted post text must render as plain React text. Match ACTUAL
  // JSX usage (`dangerouslySetInnerHTML=`), NOT the word in a safety comment.
  if (/dangerouslySetInnerHTML\s*=/.test(page)) {
    missing.push("render user post text as PLAIN React text — remove dangerouslySetInnerHTML");
  }
  return { ok: missing.length === 0, missing };
};

export const guestbookKit: Kit = {
  id: "guestbook",
  title: "Guestbook / wall",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
