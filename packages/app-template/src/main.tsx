// Fixed entry point — the builder agent never edits this file.
// Handshakes with the host (or falls back to the standalone mock), shows the
// "Open in SuperJam" banner when standalone, wraps the generated App in an
// error boundary, and mounts into #root passing { sdk, ctx } as props.
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SuperJam, type AppContext, type SuperJamSdk } from "@superjam/sdk";
import App from "./app";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="tj-card tj-center">
          <h1 className="tj-title">This jam crashed 😵</h1>
          <p className="tj-sub">{this.state.error.message}</p>
          <button className="tj-btn" onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function StandaloneBanner() {
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "var(--text)", color: "#fff", textAlign: "center",
      padding: "6px 12px", fontSize: 13, fontWeight: 700,
    }}>
      ⚡ Preview mode — open in SuperJam for the full experience
    </div>
  );
}

const sdk: SuperJamSdk = await SuperJam.connect();
const ctx: AppContext = sdk.app.context();

const root = createRoot(document.getElementById("root")!);
root.render(
  <ErrorBoundary>
    {sdk.standalone && <StandaloneBanner />}
    <App sdk={sdk} ctx={ctx} />
  </ErrorBoundary>,
);
