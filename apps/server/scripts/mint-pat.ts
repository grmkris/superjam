// Mint a SuperJam Personal Access Token (PAT) for a user, so their Claude Code can
// hire builders via the MCP AS them. The raw `sjat_…` token prints ONCE — paste it
// into Claude Code's MCP config (Authorization: Bearer …). Insert goes through
// drizzle so the typeid PK default applies.
//
//   DATABASE_URL=<pg url> bun run apps/server/scripts/mint-pat.ts <email|userId> [name]
//
// Requires the `user_token` table (migration 0012) to exist (runs on server boot).
import { createDb, schema } from "@superjam/db";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

const { user, userToken } = schema;

const arg = process.argv[2];
const label = process.argv[3] ?? "Claude Code (MCP)";
if (!arg) throw new Error("usage: mint-pat.ts <email|userId> [name]");

const url = process.env.DATABASE_URL ?? process.env.DB_PUBLIC_URL;
if (!url) throw new Error("set DATABASE_URL (or DB_PUBLIC_URL)");
const { db } = createDb(url);

const row = arg.includes("@")
  ? await db.query.user.findFirst({ where: eq(user.email, arg) })
  : await db.query.user.findFirst({ where: eq(user.id, arg as never) });
if (!row) throw new Error(`no user for ${arg}`);
console.log(`user: ${row.username} (${row.id}) · worldVerified=${row.worldVerified} · unlinkAddress=${row.unlinkAddress ?? "—"}`);

const raw = `sjat_${randomBytes(32).toString("hex")}`;
const hash = createHash("sha256").update(raw).digest("hex");
await db.insert(userToken).values({
  userId: row.id,
  name: label,
  tokenHash: hash,
  tokenPreview: `${raw.slice(0, 12)}…`,
});

console.log("\n✅ PAT (shown once — paste into Claude Code's MCP config):\n");
console.log(`   ${raw}\n`);
console.log("MCP config (.mcp.json):");
console.log(
  JSON.stringify(
    {
      mcpServers: {
        superjam: {
          type: "http",
          url: "https://dev.superjam.fun/mcp",
          headers: { Authorization: `Bearer ${raw}` },
        },
      },
    },
    null,
    2
  )
);
process.exit(0);
