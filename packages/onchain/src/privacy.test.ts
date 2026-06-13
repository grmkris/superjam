// The privacy rail degrades by design (§15). These pin the fallback triggers:
// no key ⇒ the null client (public fallback), gated payX402 stays disabled.
import { describe, expect, test } from "bun:test";
import { parseUsdc } from "./money.ts";
import {
  type UnlinkTransport,
  createUnlinkClient,
  nullUnlink,
} from "./privacy.ts";

const stubTransport: UnlinkTransport = {
  privateTransfer: async () => ({ hash: "0xpriv" }),
  faucetPrivateTokens: async () => ({ hash: "0xfaucet" }),
  payX402: async () => ({ hash: "0x402" }),
};

describe("createUnlinkClient", () => {
  test("no API key ⇒ degraded null client (callers go public)", () => {
    expect(createUnlinkClient({ transport: stubTransport })).toBe(nullUnlink);
    expect(createUnlinkClient({ apiKey: "k" })).toBe(nullUnlink); // no transport
    expect(nullUnlink.available).toBe(false);
  });

  test("key + transport ⇒ available; private transfer relays", async () => {
    const client = createUnlinkClient({ apiKey: "k", transport: stubTransport });
    expect(client.available).toBe(true);
    const { hash } = await client.privateTransfer({
      fromUnlinkAddress: "unlink1a",
      toUnlinkAddress: "unlink1b",
      amount: parseUsdc("0.5"),
    });
    expect(hash).toBe("0xpriv");
  });

  test("payX402 stays disabled until the Gateway leg is configured", async () => {
    const off = createUnlinkClient({ apiKey: "k", transport: stubTransport });
    await expect(
      off.payX402({ fromUnlinkAddress: "u", url: "https://x", amount: parseUsdc("1") })
    ).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });

    const on = createUnlinkClient({
      apiKey: "k",
      transport: stubTransport,
      gatewayConfigured: true,
    });
    expect((await on.payX402({ fromUnlinkAddress: "u", url: "https://x", amount: parseUsdc("1") })).hash).toBe("0x402");
  });

  test("null client rejects every op so the caller falls back", async () => {
    await expect(
      nullUnlink.faucetPrivateTokens({ toUnlinkAddress: "u", amount: parseUsdc("5") })
    ).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });
  });
});
