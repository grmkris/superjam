"use client";

// Shared connect plumbing for every showcase jam: handshake with the host (or
// fall back to the standalone mock), show a preview banner when standalone, wrap
// the jam in an error boundary. Mirrors packages/app-template/src/main.tsx but
// as a reusable Next client component so each route stays tiny.
import SuperJam, { type AppContext, type SuperJamSdk } from "./superjam-sdk";
import { Component, type ReactNode, useEffect, useState } from "react";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="tj-card tj-center">
          <h1 className="tj-title">This jam crashed 😵</h1>
          <p className="tj-sub">{this.state.error.message}</p>
          <button className="tj-btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function StandaloneBanner() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "var(--text)",
        color: "#fff",
        textAlign: "center",
        padding: "6px 12px",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      ⚡ Preview mode — open in SuperJam for the full experience
    </div>
  );
}

/** Drop-in page body: connects, then renders your jam with { sdk, ctx }. */
export function JamPage({
  render,
}: {
  render: (sdk: SuperJamSdk, ctx: AppContext) => ReactNode;
}) {
  const [jam, setJam] = useState<{ sdk: SuperJamSdk; ctx: AppContext; standalone: boolean } | null>(
    null
  );
  useEffect(() => {
    let alive = true;
    void SuperJam.connect().then((sdk) => {
      if (!alive) return;
      setJam({ sdk, ctx: sdk.app.context(), standalone: sdk.standalone });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!jam) {
    return (
      <div className="tj-card tj-center">
        <div className="tj-spin" />
      </div>
    );
  }
  return (
    <ErrorBoundary>
      {jam.standalone && <StandaloneBanner />}
      {render(jam.sdk, jam.ctx)}
    </ErrorBoundary>
  );
}
