// The app's own data layer (pivot §5). Uses Neon (serverless HTTP driver, the
// lowest-cold-start option for Vercel functions) when DATABASE_URL is set,
// otherwise an in-memory fallback so the template runs with ZERO infra — the
// "optional Neon" story. A real builder injects DATABASE_URL at deploy time.
import { neon } from "@neondatabase/serverless";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { entries, type Entry } from "./schema";

export interface NewEntry {
  superjamUserId: string;
  username: string;
  worldVerified: boolean;
  message: string;
}

const url = process.env.DATABASE_URL;
const db = url ? drizzle(neon(url), { schema: { entries } }) : null;

// In-memory fallback (per server instance) when no DATABASE_URL is configured.
const mem: Entry[] = [];
let memId = 0;

export const listEntries = async (limit = 50): Promise<Entry[]> => {
  if (!db) return mem.slice(-limit).toReversed();
  return db.select().from(entries).orderBy(desc(entries.createdAt)).limit(limit);
};

export const addEntry = async (e: NewEntry): Promise<Entry> => {
  if (!db) {
    memId += 1;
    const row: Entry = {
      id: memId,
      superjamUserId: e.superjamUserId,
      username: e.username,
      worldVerified: e.worldVerified,
      message: e.message,
      createdAt: new Date(),
    };
    mem.push(row);
    return row;
  }
  const [row] = await db.insert(entries).values(e).returning();
  return row!;
};

/** Whether a real database is wired (surfaced in the UI). */
export const hasDatabase = (): boolean => db !== null;
