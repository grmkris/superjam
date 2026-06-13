// Row factories for tests (house pattern, sonara). DI'd a db; never module-mock.
import type { Database } from "@superjam/db";
import { schema } from "@superjam/db";

const { user, app } = schema;
type User = typeof schema.user.$inferSelect;
type App = typeof schema.app.$inferSelect;

let seq = 0;
const next = (): string => {
  seq += 1;
  return seq.toString(36);
};

export const createTestUser = async (
  db: Database,
  overrides: Partial<typeof schema.user.$inferInsert> = {}
): Promise<User> => {
  const n = next();
  const [row] = await db
    .insert(user)
    .values({
      dynamicUserId: `dyn_${n}`,
      email: `u${n}@test.io`,
      username: `u${n}`,
      worldVerified: false,
      ...overrides,
    })
    .returning();
  return row!;
};

export const createTestApp = async (
  db: Database,
  ownerUserId: User["id"],
  overrides: Partial<typeof schema.app.$inferInsert> = {}
): Promise<App> => {
  const n = next();
  const [row] = await db
    .insert(app)
    .values({
      slug: `app-${n}`,
      name: `Jam ${n}`,
      ownerUserId,
      status: "deployed",
      ...overrides,
    })
    .returning();
  return row!;
};
