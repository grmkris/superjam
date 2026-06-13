// In-memory rate limiting + daily quotas (single process, §12). A factory, not
// a module singleton, so it's DI'd: production builds one at boot (lives in the
// context); tests build a fresh one per harness for isolation. Lifted from the
// PoC bridge.
export interface RateLimiter {
  /** Sliding 60s window; true while under `max` for this key. */
  allow(key: string, max: number): boolean;
  /** Daily counter; reserves one unit, false when over `max`. */
  quota(key: string, max: number): { ok: boolean; remaining: number; resetAt: number };
  /** Return a previously-reserved daily unit (on confirmed downstream failure). */
  refund(key: string): void;
}

const dayKey = (): string => new Date().toISOString().slice(0, 10);
const nextMidnight = (): number =>
  new Date(new Date().setUTCHours(24, 0, 0, 0)).getTime();

export const createRateLimiter = (): RateLimiter => {
  const windows = new Map<string, { n: number; reset: number }>();
  const daily = new Map<string, { day: string; n: number }>();

  return {
    allow(key, max) {
      const now = Date.now();
      const b = windows.get(key);
      if (!b || now > b.reset) {
        windows.set(key, { n: 1, reset: now + 60_000 });
        return true;
      }
      b.n += 1;
      return b.n <= max;
    },
    quota(key, max) {
      const day = dayKey();
      let e = daily.get(key);
      if (!e || e.day !== day) {
        e = { day, n: 0 };
        daily.set(key, e);
      }
      if (e.n >= max) {
        return { ok: false, remaining: 0, resetAt: nextMidnight() };
      }
      e.n += 1;
      return { ok: true, remaining: max - e.n, resetAt: nextMidnight() };
    },
    refund(key) {
      const e = daily.get(key);
      if (e && e.n > 0) {
        e.n -= 1;
      }
    },
  };
};
