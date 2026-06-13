// Drizzle column helpers (house pattern, ~/code/appmisha db-utils). TypeID
// columns store a UUID in Postgres but read/write branded TypeID strings in the
// app layer; baseEntityFields = createdAt/updatedAt timestamptz with $onUpdate.
import {
  type IdTypePrefixNames,
  type TypeId,
  typeIdFromUuid,
  typeIdGenerator,
  typeIdToUuid,
} from "@superjam/shared/typeid";
import { customType, timestamp } from "drizzle-orm/pg-core";

export const typeId = <const T extends IdTypePrefixNames>(
  prefix: T,
  columnName: string
) =>
  customType<{ data: TypeId<T>; driverData: string }>({
    dataType() {
      return "uuid";
    },
    fromDriver(input: string): TypeId<T> {
      return typeIdFromUuid(prefix, input);
    },
    toDriver(input: TypeId<T>): string {
      return typeIdToUuid(input).uuid;
    },
  })(columnName);

/** A TypeID primary-key column that auto-generates a branded id on insert. */
export const typeIdPk = <const T extends IdTypePrefixNames>(
  prefix: T,
  columnName = "id"
) =>
  typeId(prefix, columnName)
    .primaryKey()
    .$defaultFn(() => typeIdGenerator(prefix));

const createTimestampField = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const baseEntityFields = {
  createdAt: createTimestampField("created_at").defaultNow().notNull(),
  updatedAt: createTimestampField("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};
