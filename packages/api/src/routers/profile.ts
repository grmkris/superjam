// profile router (§12). M1 ships `me`; topup lands in M6 (worldVerified, both
// rails). Never leak dynamicUserId / worldNullifierHash to the client.
import type { schema } from "@superjam/db";
import { protectedProcedure } from "../orpc.ts";

type User = typeof schema.user.$inferSelect;

export const toMe = (user: User) => ({
  id: user.id,
  username: user.username,
  ensName: user.ensName,
  email: user.email,
  walletAddress: user.walletAddress,
  worldVerified: user.worldVerified,
  freeBuildsUsed: user.freeBuildsUsed,
  unlinkAddress: user.unlinkAddress,
  createdAt: user.createdAt,
});

export const profileRouter = {
  me: protectedProcedure.handler(({ context }) => toMe(context.user)),
};
