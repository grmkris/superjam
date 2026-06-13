// Onchain-games adapter (§ builder-deploys-contracts). A jam plays against its
// OWN bespoke Arc contract (the builder deployed it; the platform stored the
// address+ABI on the app row). Reads are plain view calls on the Arc public
// client; writes are OPERATOR-relayed — the server wallet (the contract's
// operator) signs + pays gas, and the api bridge has already PREPENDED the
// verified player address as the first arg, so a jam can never spoof "who".
//
// DB-free + stateless like the rest of @superjam/onchain: address/abi/args are
// passed in (resolved from the app row in the api), never looked up here.
import type { Abi, Address, Hex, PublicClient } from "viem";
import type { ServerWallet } from "./server-wallet.ts";

export interface GameCallParams {
  address: Address;
  abi: Abi;
  functionName: string;
  /** Already player-stamped + ordered by the caller; coerced to ABI types here. */
  args?: readonly unknown[];
}

export interface GameContract {
  /** View call — returns the decoded result (bigints stringified by the api). */
  read(p: GameCallParams): Promise<unknown>;
  /** Operator-relayed state change — server wallet signs + pays Arc gas. */
  write(p: GameCallParams): Promise<Hex>;
}

/** Args arrive as JSON (string/number/bool) over the bridge, but viem needs
 *  bigint for uint/int types and a 0x string for address/bytes. Coerce each arg
 *  to the type its ABI input declares; unknown shapes pass through untouched. */
const coerceArgs = (
  abi: Abi,
  functionName: string,
  args: readonly unknown[]
): readonly unknown[] => {
  const fn = abi.find(
    (e): e is Extract<Abi[number], { type: "function" }> =>
      e.type === "function" && e.name === functionName
  );
  if (!fn) return args;
  return args.map((a, i) => {
    const t = fn.inputs[i]?.type ?? "";
    if (/^u?int\d*$/.test(t)) {
      return typeof a === "bigint" ? a : BigInt(a as string | number);
    }
    if (t === "bool") return typeof a === "boolean" ? a : a === "true" || a === true;
    return a; // address/string/bytes/tuple — viem accepts the JSON value as-is
  });
};

export const createGameContract = (
  publicClient: PublicClient,
  serverWallet: ServerWallet
): GameContract => ({
  read: ({ address, abi, functionName, args = [] }) =>
    publicClient.readContract({
      address,
      abi,
      functionName,
      args: coerceArgs(abi, functionName, args),
    }),
  write: ({ address, abi, functionName, args = [] }) =>
    serverWallet.writeContract({
      address,
      abi,
      functionName,
      args: coerceArgs(abi, functionName, args),
    }),
});
