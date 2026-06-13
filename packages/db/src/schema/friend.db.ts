// friendship (§3e) — instant + mutual: `add @user` makes friends immediately,
// no request/accept. Stored as ONE canonical-pair row (userAId < userBId, the
// branded-id string ordering) so it's symmetric + dedupable. list = where
// userAId=me OR userBId=me.
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { baseEntityFields, typeId, typeIdPk } from "../utils/db-utils.ts";
import { user } from "./user.db.ts";

export const friendship = pgTable(
  "friendship",
  {
    id: typeIdPk("friendship"),
    userAId: typeId("user", "user_a_id")
      .notNull()
      .references(() => user.id),
    userBId: typeId("user", "user_b_id")
      .notNull()
      .references(() => user.id),
    ...baseEntityFields,
  },
  (t) => [
    uniqueIndex("friendship_pair_uq").on(t.userAId, t.userBId),
    index("friendship_user_a_idx").on(t.userAId),
    index("friendship_user_b_idx").on(t.userBId),
  ]
);

export type Friendship = typeof friendship.$inferSelect;
