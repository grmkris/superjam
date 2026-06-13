// The mini-app viewer (pivot §3). Resolves the slug to the external app via the
// public apps.get, then frames its entryUrl. The per-app frame-src CSP is set by
// middleware.ts. Identity: the viewer's Dynamic session supplies the auth token
// the host uses to mint app tokens — wired with the login chrome (lane: web
// login). Until then the frame loads and runs; sign-in-gated SDK calls reject.
import { notFound } from "next/navigation";
import {
  AppFrame,
  type HostUser,
  type ViewerApp,
} from "../../../components/app-frame";
import {
  browserRpcUrl,
  createPlatformClient,
  serverRpcUrl,
} from "../../../lib/orpc";

const GUEST: HostUser = {
  id: "guest",
  username: "guest",
  walletAddress: "0x0000000000000000000000000000000000000000",
  worldVerified: false,
};

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

  // TODO(web login): replace GUEST + null token with the Dynamic session user
  // and JWT so auth.mintAppToken (and other protected bridge calls) work.
  return (
    <main style={{ height: "100dvh", margin: 0 }}>
      <AppFrame app={app} user={GUEST} rpcUrl={browserRpcUrl()} authToken={null} />
    </main>
  );
}
