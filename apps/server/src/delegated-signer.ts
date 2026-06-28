// The server signing AS the user via Dynamic Delegated Access (§23). On approval,
// the `wallet.delegation.created` webhook stores the user's MPC key share + per-wallet
// API key (delegation.db). Here we use them to produce the user's EIP-712 signature
// over an EIP-3009 transfer authorization — no browser, no per-tx popup.
//
// Server-only: the Dynamic Node SDK pulls Node APIs, so this lives in apps/server
// (NOT @superjam/onchain or @superjam/api, which the web bundle imports). Wired into
// the request context at boot, mirroring the Dynamic TSS server wallet.
import type { ServerKeyShare } from "@dynamic-labs-wallet/node";
import {
  createDelegatedEvmWalletClient,
  delegatedSignTypedData,
} from "@dynamic-labs-wallet/node-evm";
import type { DelegatedSigner } from "@superjam/api";
import { type Database, schema } from "@superjam/db";
import type { TransferAuthTypedData } from "@superjam/onchain";
import type { UserId } from "@superjam/shared";
import { eq } from "drizzle-orm";
import type { Hex, TypedData } from "viem";

export interface DelegatedSignerEnv {
  environmentId: string;
  /** The Dynamic server API token (same `dyn_…` the MPC server wallet uses). */
  apiToken: string;
}

/** Present only when both vars are set — else undefined so delegated paths reject. */
export const delegatedSignerEnv = (): DelegatedSignerEnv | undefined => {
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
  const apiToken = process.env.DYNAMIC_API_TOKEN;
  if (!environmentId || !apiToken) return undefined;
  return { environmentId, apiToken };
};

export const createDelegatedSigner = (
  env: DelegatedSignerEnv,
  db: Database,
): DelegatedSigner => {
  const client = createDelegatedEvmWalletClient({
    environmentId: env.environmentId,
    apiKey: env.apiToken,
  });
  const { userDelegation } = schema;
  const lookup = (userId: string) =>
    db.query.userDelegation.findFirst({
      where: eq(userDelegation.userId, userId as UserId),
    });

  return {
    async hasDelegation(userId) {
      return Boolean(await lookup(userId));
    },
    async signTransferAuth(
      userId: string,
      typed: TransferAuthTypedData,
    ): Promise<Hex> {
      const row = await lookup(userId);
      if (!row) {
        throw new Error("No wallet delegation on file for this user");
      }
      const signature = await delegatedSignTypedData(client, {
        walletId: row.walletId,
        shareSetId: row.shareSetId ?? undefined,
        walletApiKey: row.walletApiKey,
        keyShare: row.keyShare as ServerKeyShare,
        // Dynamic types this param as `TypedData` but its runtime feeds it to
        // viem `hashTypedData`, which consumes the full {domain,types,primaryType,
        // message} payload — exactly TransferAuthTypedData. Cast across the
        // imprecise SDK type.
        typedData: typed as unknown as TypedData,
      });
      return signature as Hex;
    },
  };
};
