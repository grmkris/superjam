// Branded money units (§15). `Usdc` is a 6-decimal base-unit bigint, branded
// distinct from the Arc-native 18-decimal unit so cross-unit math fails to
// compile at function boundaries. THE FOOTGUN (§15): on Arc the 18-dec native
// balance and the 6-dec ERC-20 at 0x3600…0000 are the SAME balance — read ONE,
// never sum, never mix. The brand is the guardrail. Decimal-string is the wire
// format (parseUsdc/formatUsdc only).
import { formatUnits, parseUnits } from "viem";

export const USDC_DECIMALS = 6;
export const ARC_NATIVE_DECIMALS = 18;

declare const usdcBrand: unique symbol;
/** USDC in 6-decimal base units. Never mix with `ArcNative` (§15). */
export type Usdc = bigint & { readonly [usdcBrand]: never };

declare const arcNativeBrand: unique symbol;
/** Arc-native gas units (18-dec). Distinct brand — the SAME balance as the
 *  6-dec USDC ERC-20, just a different read; never sum the two (§15). */
export type ArcNative = bigint & { readonly [arcNativeBrand]: never };

/** Wrap a raw base-unit bigint as `Usdc` (use only where the unit is known). */
export const usdc = (raw: bigint): Usdc => raw as Usdc;

/** Parse a decimal string (the wire format) into 6-dec base units. */
export const parseUsdc = (decimal: string): Usdc =>
  parseUnits(decimal, USDC_DECIMALS) as Usdc;

/** Format 6-dec base units back to the decimal wire string. */
export const formatUsdc = (value: Usdc): string =>
  formatUnits(value, USDC_DECIMALS);

// Brand-preserving arithmetic. Plain `a + b` on bigints loses the brand in TS;
// these keep it so pot pro-rata math stays in `Usdc` end to end.
export const addUsdc = (a: Usdc, b: Usdc): Usdc => (a + b) as Usdc;
export const sumUsdc = (xs: readonly Usdc[]): Usdc =>
  xs.reduce<Usdc>((acc, x) => addUsdc(acc, x), 0n as Usdc);
export const gteUsdc = (a: Usdc, b: Usdc): boolean => a >= b;

/** Pro-rata share: `total * part / whole`, floored, staying in `Usdc` (§9 pot
 *  payout). `whole` must be > 0 (caller guarantees the winning pool is nonzero). */
export const proRata = (total: Usdc, part: Usdc, whole: Usdc): Usdc =>
  ((total * part) / whole) as Usdc;

export const ZERO_USDC = 0n as Usdc;
