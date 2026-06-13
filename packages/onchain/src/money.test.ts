// Pot payout correctness rides on `proRata`/`sumUsdc` (§9). Floors, never
// over-distributes, stays in branded `Usdc`.
import { describe, expect, test } from "bun:test";
import { formatUsdc, parseUsdc, proRata, sumUsdc } from "./money.ts";

describe("usdc math", () => {
  test("parse/format roundtrip at 6 decimals", () => {
    expect(formatUsdc(parseUsdc("0.50"))).toBe("0.5");
    expect(parseUsdc("1")).toBe(1_000_000n as never);
  });

  test("proRata floors and never exceeds the pool", () => {
    // pool 3 USDC split across stakes 1 and 2 on the winning option.
    const pool = parseUsdc("3");
    const winners = [parseUsdc("1"), parseUsdc("2")];
    const whole = sumUsdc(winners);
    const payouts = winners.map((w) => proRata(pool, w, whole));
    expect(formatUsdc(payouts[0]!)).toBe("1");
    expect(formatUsdc(payouts[1]!)).toBe("2");
    expect(sumUsdc(payouts) <= pool).toBe(true);
  });

  test("uneven split floors — dust stays in escrow, never over-pays", () => {
    const pool = parseUsdc("1"); // 1.000000
    const winners = [parseUsdc("1"), parseUsdc("1"), parseUsdc("1")];
    const whole = sumUsdc(winners);
    const payouts = winners.map((w) => proRata(pool, w, whole));
    // 1_000_000 / 3 = 333_333 each → 999_999 total, 1 base-unit dust retained.
    expect(payouts.every((p) => p === (333_333n as never))).toBe(true);
    expect(sumUsdc(payouts) < pool).toBe(true);
  });
});
