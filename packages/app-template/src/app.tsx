// ★ GENERATED FILE — the builder agent overwrites this with the real app.
// Contract: default-export `App({ sdk, ctx })`. Available deps: react +
// @superjam/sdk (see SDK.md) + exactly what your loaded skills/*.md document.
// Style with theme.css classes (tj-card, tj-btn, …) or inline styles.
import type { SuperJamSdk, AppContext } from "@superjam/sdk";

export default function App({ sdk, ctx }: { sdk: SuperJamSdk; ctx: AppContext }) {
  void sdk;
  return (
    <div className="tj-card tj-center">
      <h1 className="tj-title">Not built yet</h1>
      <p className="tj-sub">hello @{ctx.user.username} 👋</p>
    </div>
  );
}
