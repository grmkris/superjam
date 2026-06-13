// TypeID — branded, prefixed ids with a zod validator and uuid storage.
// House pattern lifted from ~/code/appmisha/packages/shared/src/typeid.ts,
// trimmed to SuperJam's domain prefixes (§7).
import { fromString, getType, toUUID, TypeID, typeid } from "typeid-js";
import { z } from "zod";

const TYPEID_SUFFIX_LENGTH = 26;

// §7 prefixes: user→usr, app→app, build→bld, record→rec, publishPayment→pub,
// review→rvw, message→msg, builderAgent→bag, pot→pot, potStake→pst.
export const idTypesMapNameToPrefix = {
  user: "usr",
  app: "app",
  build: "bld",
  record: "rec",
  publishPayment: "pub",
  review: "rvw",
  message: "msg",
  builderAgent: "bag",
  pot: "pot",
  potStake: "pst",
  friendship: "fnd",
  directMessage: "dm",
} as const;

type IdTypesMapNameToPrefix = typeof idTypesMapNameToPrefix;

type IdTypesMapPrefixToName = {
  [K in keyof IdTypesMapNameToPrefix as IdTypesMapNameToPrefix[K]]: K;
};

const idTypesMapPrefixToName = Object.fromEntries(
  Object.entries(idTypesMapNameToPrefix).map(([name, prefix]) => [prefix, name])
) as IdTypesMapPrefixToName;

export type IdTypePrefixNames = keyof typeof idTypesMapNameToPrefix;

export type TypeId<T extends IdTypePrefixNames> =
  `${(typeof idTypesMapNameToPrefix)[T]}_${string}`;

export const typeIdValidator = <const T extends IdTypePrefixNames>(prefix: T) =>
  z
    .string()
    .startsWith(`${idTypesMapNameToPrefix[prefix]}_`)
    .length(TYPEID_SUFFIX_LENGTH + idTypesMapNameToPrefix[prefix].length + 1)
    .refine(
      (input) => {
        try {
          TypeID.fromString(input).asType(idTypesMapNameToPrefix[prefix]);
          return true;
        } catch {
          return false;
        }
      },
      { message: `Invalid ${prefix} TypeID format` }
    ) as z.ZodType<TypeId<T>, TypeId<T>>;

export const typeIdGenerator = <const T extends IdTypePrefixNames>(prefix: T) =>
  typeid(idTypesMapNameToPrefix[prefix]).toString() as TypeId<T>;

export const typeIdFromUuid = <const T extends IdTypePrefixNames>(
  prefix: T,
  uuid: string
) =>
  TypeID.fromUUID(idTypesMapNameToPrefix[prefix], uuid).toString() as TypeId<T>;

export const typeIdToUuid = <const T extends IdTypePrefixNames>(
  input: TypeId<T>
) => {
  const id = fromString(input);
  return { uuid: toUUID(id).toString(), prefix: getType(id) };
};

export const validateTypeId = <const T extends IdTypePrefixNames>(
  prefix: T,
  data: unknown
): data is TypeId<T> => typeIdValidator(prefix).safeParse(data).success;

export const inferTypeId = <T extends keyof IdTypesMapPrefixToName>(
  input: `${T}_${string}`
) =>
  idTypesMapPrefixToName[
    TypeID.fromString(input).getType() as T
  ] as unknown as T;

// Branded id validators + types, one per domain entity.
export const UserId = typeIdValidator("user");
export type UserId = z.infer<typeof UserId>;
export const AppId = typeIdValidator("app");
export type AppId = z.infer<typeof AppId>;
export const BuildId = typeIdValidator("build");
export type BuildId = z.infer<typeof BuildId>;
export const RecordId = typeIdValidator("record");
export type RecordId = z.infer<typeof RecordId>;
export const PublishPaymentId = typeIdValidator("publishPayment");
export type PublishPaymentId = z.infer<typeof PublishPaymentId>;
export const ReviewId = typeIdValidator("review");
export type ReviewId = z.infer<typeof ReviewId>;
export const MessageId = typeIdValidator("message");
export type MessageId = z.infer<typeof MessageId>;
export const BuilderAgentId = typeIdValidator("builderAgent");
export type BuilderAgentId = z.infer<typeof BuilderAgentId>;
export const PotId = typeIdValidator("pot");
export type PotId = z.infer<typeof PotId>;
export const PotStakeId = typeIdValidator("potStake");
export type PotStakeId = z.infer<typeof PotStakeId>;
export const FriendshipId = typeIdValidator("friendship");
export type FriendshipId = z.infer<typeof FriendshipId>;
export const DirectMessageId = typeIdValidator("directMessage");
export type DirectMessageId = z.infer<typeof DirectMessageId>;
