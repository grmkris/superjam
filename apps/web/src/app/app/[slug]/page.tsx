// The mini-app viewer (pivot §3). Resolves the slug to the external app via the
// public apps.get, then hands it to <AppViewer> — the super-app host view that
// runs the app WINDOWED inside the phone column (header → /j detail, ⛶ fullscreen,
// ✕ close, bottom tabs) with a fullscreen escape hatch. The client view wires the
// signed-in identity into the cross-origin AppFrame via <AppHost>. The per-app
// frame-src CSP is set by middleware (%67). AppChrome leaves /app/* full-bleed, so
// AppViewer owns the entire layout.
import { notFound } from "next/navigation";
import { AppViewer } from "../../../components/app-viewer";
import type { ViewerApp } from "../../../components/app-frame";
import { createPlatformClient, serverRpcUrl } from "../../../lib/orpc";

export default async function AppViewerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let app: ViewerApp;
  try {
    app = (await createPlatformClient({ url: serverRpcUrl() }).apps.get({
      slug,
    })) as ViewerApp;
  } catch {
    notFound();
  }

  return <AppViewer app={app} />;
}
