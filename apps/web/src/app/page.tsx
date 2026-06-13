// Landing / marketplace stub. The Explore grid + Dynamic login chrome land with
// the web frontend lane; the pivot-critical surface is the /app/[slug] viewer.
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 32 }}>
      <h1>🟡 SuperJam</h1>
      <p style={{ color: "#555" }}>
        Make and play AI mini-apps. Open a jam at{" "}
        <code>/app/&lt;slug&gt;</code>.
      </p>
    </main>
  );
}
