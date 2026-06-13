// Tiny className joiner — no clsx dep, keeps the product UI self-contained.
export type ClassValue = string | false | null | undefined;

export const cx = (...parts: ClassValue[]): string =>
  parts.filter(Boolean).join(" ");
