// Seed jam — Fan Wall (shared collection insert/list + storage draft autosave).
import { useEffect, useState } from "react";
import type { SuperJamSdk, AppContext, Doc } from "@superjam/sdk";

const FLAGS = ["🇦🇷", "🇧🇷", "🇫🇷", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🇪🇸", "🇵🇹", "🇳🇱", "🇩🇪", "🇯🇵", "🇲🇽", "🇺🇸", "🌍"];

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  const me = ctx.user.username;
  const wall = sdk.data.collection("entries");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [draft, setDraft] = useState("");
  const [flag, setFlag] = useState("🌍");

  useEffect(() => {
    void wall.list({ orderBy: { field: "createdAt", dir: "desc" }, limit: 100 }).then((r) => setDocs(r.docs));
    void sdk.storage.get<string>("draft").then((d) => { if (d) setDraft(d); });
  }, []);

  async function sign() {
    const text = draft.trim();
    if (!text) return;
    const { id, createdAt } = await wall.insert({ text, flag });
    setDocs([
      { id, createdAt, userId: ctx.user.id, username: me, worldVerified: ctx.user.worldVerified, data: { text, flag } },
      ...docs,
    ]);
    setDraft("");
    await sdk.storage.delete("draft");
  }

  function onType(v: string) {
    setDraft(v);
    void sdk.storage.set("draft", v); // survives reloads
  }

  return (
    <div className="tj-card">
      <h1 className="tj-title">Fan Wall ✍️</h1>
      <p className="tj-sub">Sign in with your colors.</p>
      <div className="tj-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        {FLAGS.map((f) => (
          <button key={f} className="tj-btn tj-btn-ghost" style={{ padding: "4px 8px", outline: flag === f ? "3px solid var(--accent)" : undefined }}
            onClick={() => setFlag(f)}>{f}</button>
        ))}
      </div>
      <div className="tj-row">
        <input className="tj-input" value={draft} maxLength={140} placeholder="Say hi…"
          onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void sign(); }} />
        <button className="tj-btn" onClick={sign}>Sign</button>
      </div>
      <ul className="tj-list">
        {docs.map((d) => (
          <li key={d.id}>
            <span>{String(d.data.flag ?? "🌍")}</span> <b>@{d.username}</b> {String(d.data.text)}
            {d.username === me && (
              <button className="tj-btn tj-btn-ghost" style={{ marginLeft: "auto", padding: "2px 8px" }}
                onClick={() => { void wall.delete(d.id); setDocs(docs.filter((x) => x.id !== d.id)); }}>✕</button>
            )}
          </li>
        ))}
        {docs.length === 0 && <div className="tj-empty">No signatures yet — be the first!</div>}
      </ul>
    </div>
  );
}
