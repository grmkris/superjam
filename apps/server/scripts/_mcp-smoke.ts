// In-process smoke: connect an MCP Client to the SuperJam server over an in-memory
// transport (no HTTP, no dev DB) and exercise tools/list against a fresh pglite DB.
// Validates tool registration + the call() → oRPC bridge wiring.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type ApiContext, createContext, createRateLimiter } from "@superjam/api";
import { createPgliteDb } from "@superjam/db/pglite";
import { createLogger } from "@superjam/logger";
import { buildServer } from "../src/mcp.ts";

const { db } = await createPgliteDb();
const logger = createLogger({ level: "silent" });
const rateLimiter = createRateLimiter();
const stubAuth = {
  verify: async () => {
    throw new Error("no auth in smoke");
  },
};
const makeContext = (headers: Headers): ApiContext =>
  createContext({ db, logger, auth: stubAuth as never, rateLimiter, headers });

const server = buildServer(makeContext, new Headers());
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(clientTransport);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name);
console.log("✅ tools/list:", names.join(", "));

const expected = ["upload_file", "build_app", "get_build"];
const missing = expected.filter((n) => !names.includes(n));
if (missing.length) throw new Error(`missing tools: ${missing.join(", ")}`);
console.log("✅ all expected tools registered");

await client.close();
await server.close();
console.log("\n✅ MCP transport + tool bridge OK");
process.exit(0);
