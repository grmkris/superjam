"use client";

// Host auth provider (pivot §1 login seam). Wraps the app in Dynamic's NEW
// headless SDK (@dynamic-labs-sdk/*): a single client instance (lib/dynamic-client)
// shared via <DynamicProvider>. The old React-context SDK duplicated under
// Turbopack and crashed login; the singleton client cannot. <LoginProvider> owns
// the email→code login UI the headless SDK no longer ships.
import { DynamicProvider } from "@dynamic-labs-sdk/react-hooks";
import type { ReactNode } from "react";
import { dynamicClient } from "../lib/dynamic-client";
import { LoginProvider } from "./login";

export function Providers({ children }: { children: ReactNode }) {
  // dynamicClient is null when NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID wasn't baked
  // into the build (every Dynamic call would otherwise crash cryptically). Fail
  // with a clear, actionable message instead of white-screening the app.
  if (!dynamicClient) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40 }}>🔧</div>
          <h1 style={{ fontSize: 18, margin: "8px 0" }}>Auth not configured</h1>
          <p style={{ color: "#666", fontSize: 14 }}>
            This build was created without{" "}
            <code>NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID</code>. Set it as a web
            build arg and redeploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <DynamicProvider client={dynamicClient}>
      <LoginProvider>{children}</LoginProvider>
    </DynamicProvider>
  );
}
