// The mini-app viewer (pivot §3). Resolves the slug to the external app via the
// public apps.get, then hands it to <AppHost> (%67's client seam) which wires
// the signed-in identity (useHostAuth) + getAddress into the cross-origin
// AppFrame. The per-app frame-src CSP is set by middleware (%67). Full-bleed:
// AppChrome renders no tab bar on /app/* routes.
import { notFound } from "next/navigation";
import { AppHost } from "../../../components/app-host";
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

  return (
    <main className="app-bleed">
      <AppHost app={app} />
    </main>
  );
}
