// Global bun test setup (wired via bunfig.toml `[test] preload`). Closes every
// pglite client created during the run on teardown — tests create per-test pglite
// DBs and never close them, and the leaked WASM workers otherwise surface as an
// unhandled rejection that makes `bun test` exit non-zero even with 0 failures.
// Reads the registry off globalThis (populated by @superjam/db/pglite) so this file
// needs no workspace imports.
import { afterAll } from "bun:test";

interface Closeable {
  close(): Promise<void>;
}

afterAll(async () => {
  const clients = (globalThis as Record<string, unknown>)[
    "__superjam_pglite_clients__"
  ] as Set<Closeable> | undefined;
  if (!clients) return;
  const list = [...clients];
  clients.clear();
  await Promise.allSettled(list.map((c) => c.close()));
});
