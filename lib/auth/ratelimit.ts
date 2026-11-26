// In-memory login limiter: 5 failures / IP / 15 min, then lockout with growing backoff.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
type Entry = { fails: number[]; lockedUntil: number; lockCount: number };
const g = globalThis as unknown as { __rl?: Map<string, Entry> };
const store = (g.__rl ??= new Map<string, Entry>());

export function checkLimit(ip: string): { ok: true } | { ok: false; retryAfterS: number } {
  const e = store.get(ip);
  const now = Date.now();
  if (e && e.lockedUntil > now) return { ok: false, retryAfterS: Math.ceil((e.lockedUntil - now) / 1000) };
  return { ok: true };
}

export function recordFailure(ip: string): void {
  const now = Date.now();
  const e = store.get(ip) ?? { fails: [], lockedUntil: 0, lockCount: 0 };
  e.fails = e.fails.filter((t) => now - t < WINDOW_MS);
  e.fails.push(now);
  if (e.fails.length >= MAX_FAILS) {
    e.lockCount += 1;
    // 15 min, doubling on each repeated lockout, capped at 24h
    e.lockedUntil = now + Math.min(WINDOW_MS * 2 ** (e.lockCount - 1), 24 * 3600 * 1000);
    e.fails = [];
  }
  store.set(ip, e);
}

export function recordSuccess(ip: string): void {
  store.delete(ip);
}

export function clientIp(h: Headers): string {
  // Only trust proxy headers when explicitly told we're behind one; otherwise XFF is attacker-controlled
  // and would let anyone dodge the limiter. Without it, all clients share one bucket (safe for a single-token gate).
  if (process.env.TRUST_PROXY === "1") return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
  return "local";
}
