// A mock Onchain for router/service tests (§0.2 — stub externals at the code
// seam, not via env flags). Records sends so payout idempotency is assertable.
import type { Onchain } from "@superjam/onchain";
import { OnchainError, type Usdc, usdc } from "@superjam/onchain";
import type { Address, Hex } from "viem";

export interface MockOnchain extends Onchain {
  /** Every sendUsdc call, in order — assert payout count/amounts/idempotency. */
  sends: { to: Address; value: Usdc }[];
  /** Every game.write (onchain-game move) call, in order — assert the player
   *  was stamped + the target address pinned to the app's own contract. */
  gameWrites: { address: Address; functionName: string; args: readonly unknown[] }[];
  /** Override what game.read returns (default: 0n). */
  setGameRead(fn: () => unknown): void;
  /** Override the next verifyUsdcTransfer result (or make it throw). */
  setVerify(fn: NonNullable<MockOnchainOptions["verify"]>): void;
}

export interface MockOnchainOptions {
  serverAddress?: Address;
  /** Default verify behaviour; override per-test with setVerify. */
  verify?: (params: {
    expectedTo: Address;
    minAmount: Usdc;
  }) => Promise<{ from: Address; value: Usdc }>;
}

let sendSeq = 0;
const fakeHash = (): Hex => {
  sendSeq += 1;
  return `0x${sendSeq.toString(16).padStart(64, "0")}` as Hex;
};

export const createMockOnchain = (
  opts: MockOnchainOptions = {}
): MockOnchain => {
  const sends: { to: Address; value: Usdc }[] = [];
  const gameWrites: { address: Address; functionName: string; args: readonly unknown[] }[] = [];
  let gameRead: () => unknown = () => 0n;
  let verify =
    opts.verify ??
    (async () => {
      throw new OnchainError("TRANSFER_NOT_FOUND", "no stub configured");
    });

  const mock: MockOnchain = {
    serverAddress:
      opts.serverAddress ?? "0x000000000000000000000000000000000000eeee",
    sends,
    gameWrites,
    game: {
      read: async () => gameRead(),
      write: async ({ address, functionName, args = [] }) => {
        gameWrites.push({ address, functionName, args });
        return fakeHash();
      },
    },
    setGameRead(fn) {
      gameRead = fn;
    },
    setVerify(fn) {
      verify = fn;
    },
    verifyUsdcTransfer: (params) =>
      verify({ expectedTo: params.expectedTo, minAmount: params.minAmount }),
    usdcBalance: async () => usdc(0n),
    relayTransfer: async () => fakeHash(),
    sendUsdc: async (_chain, to, value) => {
      sends.push({ to, value });
      return fakeHash();
    },
    mintV2Subname: async ({ slug }) => ({
      ensName: `${slug}.superjam.eth`,
      node: `0x${"0".repeat(64)}` as Hex,
      txHash: fakeHash(),
    }),
    ensV2Addr: async () => `0x${"0".repeat(40)}` as `0x${string}`,
  };
  return mock;
};
