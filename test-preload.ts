// Global bun test setup (wired via bunfig.toml `[test] preload`). Closes every
// pglite client created so far after EACH test — tests create per-test pglite DBs
// (harness()/beforeEach; none are beforeAll/module-shared) and never close them.
// Closing per-test caps peak memory (the big api suite otherwise OOMs the runner)
// AND avoids the unhandled-rejection-on-teardown that made `bun test` exit non-zero.
// Reads the registry off globalThis (populated by @superjam/db/pglite) so this file
// needs no workspace imports.
import { afterEach } from "bun:test";

interface Closeable {
  close(): Promise<void>;
}

afterEach(async () => {
  const clients = (globalThis as Record<string, unknown>)[
    "__superjam_pglite_clients__"
  ] as Set<Closeable> | undefined;
  if (!clients || clients.size === 0) return;
  const list = [...clients];
  clients.clear();
  await Promise.allSettled(list.map((c) => c.close()));
});
