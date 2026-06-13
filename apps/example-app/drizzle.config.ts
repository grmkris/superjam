// The app's OWN database migrations (Neon). Run `bunx drizzle-kit push` (or
// `generate` + `migrate`) against DATABASE_URL to create the `entries` table.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
