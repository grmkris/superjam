// Drive a real MCP client against the LIVE SuperJam MCP. tools/list is public;
// build_app/get_build need a `sjat_` PAT (env SJ_PAT).
//   SJ_PAT=sjat_… bun run apps/server/scripts/_mcp-client.ts [mcpUrl]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(
  process.argv[2] ?? "https://server-dev-620d.up.railway.app/mcp"
);
const pat = process.env.SJ_PAT;

const transport = new StreamableHTTPClientTransport(url, {
  requestInit: pat ? { headers: { Authorization: `Bearer ${pat}` } } : undefined,
});
const client = new Client({ name: "sj-smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("✅ tools:", tools.tools.map((t) => t.name).join(", "));

await client.close();
process.exit(0);
