"use client";

// AppViewer — the super-app host view for /app/[slug]. Opening a jam by URL lands
// here and presents it FULLSCREEN via the shared AppStage (same shell as tapping
// ▸ Play in the feed): the app fills the viewport edge-to-edge with just a slim
// floating top bar. ✕ returns to the Discover feed. AppChrome leaves /app/* full-
// bleed, so there's no nav under the stage to begin with.
import { useRouter } from "next/navigation";
import type { ViewerApp } from "./app-frame";
import { AppStage } from "./app-stage";

export function AppViewer({ app }: { app: ViewerApp }) {
  const router = useRouter();
  return (
    <AppStage
      app={app}
      titleHref={`/j/${app.slug}`}
      onClose={() => router.push("/")}
    />
  );
}
