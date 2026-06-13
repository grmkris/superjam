// A mock Onchain for router/service tests (§0.2 — stub externals at the code
// seam, not via env flags). Records sends so payout idempotency is assertable.
import type { Onchain } from "@superjam/onchain";
import { OnchainError, type Usdc, usdc } from "@superjam/onchain";
import type { Address, Hex } from "viem";

export interface MockOnchain extends Onchain {
  /** Every sendUsdc call, in order — assert payout count/amounts/idempotency. */
  sends: { to: Address; value: Usdc }[];
  /** Every fundViaCctp (Sepolia→Arc bridge) call, in order. */
  bridges: { amount: Usdc; mintRecipient: Address; fast: boolean }[];
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
  unlinkAvailable?: boolean;
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
  const bridges: { amount: Usdc; mintRecipient: Address; fast: boolean }[] = [];
  let verify =
    opts.verify ??
    (async () => {
      throw new OnchainError("TRANSFER_NOT_FOUND", "no stub configured");
    });

  const mock: MockOnchain = {
    serverAddress:
      opts.serverAddress ?? "0x000000000000000000000000000000000000eeee",
    sends,
    bridges,
    stakeSlash: null,
    agentBook: { lookupHuman: async () => null },
    setVerify(fn) {
      verify = fn;
    },
    unlink: {
      available: opts.unlinkAvailable ?? false,
      privateTransfer: async () => ({ hash: fakeHash() }),
      faucetPrivateTokens: async () => ({ hash: fakeHash() }),
      payX402: async () => ({ hash: fakeHash() }),
    },
    verifyUsdcTransfer: (params) =>
      verify({ expectedTo: params.expectedTo, minAmount: params.minAmount }),
    usdcBalance: async () => usdc(0n),
    relayTransfer: async () => fakeHash(),
    sendUsdc: async (_chain, to, value) => {
      sends.push({ to, value });
      return fakeHash();
    },
    fundViaCctp: async ({ amount, mintRecipient, fast = true }) => {
      bridges.push({ amount, mintRecipient, fast });
      // mock: no fee deducted — `minted` == amount (real adapter returns amount − maxFee).
      return { burnTxHash: fakeHash(), mintTxHash: fakeHash(), minted: amount };
    },
    mintV2Subname: async ({ slug }) => ({
      ensName: `${slug}.superjam.eth`,
      node: `0x${"0".repeat(64)}` as Hex,
      txHash: fakeHash(),
    }),
    ensV2Addr: async () => `0x${"0".repeat(40)}` as `0x${string}`,
    registerAgentIdentity: async (p) => ({
      erc8004Id: `8004:${p.agentId}`,
      txHash: fakeHash(),
    }),
    writeReputation: async () => fakeHash(),
    readReputation: async () => ({ count: 0, average: 0 }),
  };
  return mock;
};
