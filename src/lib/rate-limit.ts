/**
 * Rate limiting.
 *
 * The application previously had none, so `/api/auth/login` accepted unlimited
 * attempts. With no lockout and no CAPTCHA, credential stuffing against a
 * tenant's account was free.
 *
 * IMPORTANT LIMITATION
 * --------------------
 * This is an in-process fixed-window counter. It works correctly for a single
 * instance and is deliberately dependency-free so the limiter is active by
 * default rather than waiting on Redis.
 *
 * It does NOT work across multiple instances: each container keeps its own
 * counters, so N containers allow N times the limit. Set `REDIS_URL` and swap
 * the store before scaling horizontally. `isDistributed()` reports which mode
 * is in effect so this cannot be forgotten silently.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Sweep expired buckets so the map cannot grow without bound. */
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
};

/**
 * Consume one unit against `key`.
 *
 * @param key    Identity to limit on. Combine IP and the target (e.g. email)
 *               so one attacker cannot lock out every user from one address.
 * @param limit  Maximum requests per window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(key: string, limit: number, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, limit, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);

  return {
    allowed: existing.count <= limit,
    limit,
    remaining,
    retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Clear a key early, e.g. after a successful login. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** False while using the in-process store. See the limitation above. */
export function isDistributed(): boolean {
  return false;
}

/**
 * Best-effort client IP.
 *
 * Trusts `x-forwarded-for` because this app is expected to sit behind a reverse
 * proxy or platform load balancer. A client can forge the header when the app is
 * exposed directly, so do not treat the result as an authenticated identity -
 * it is a rate-limit key, nothing more.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

export const LOGIN_LIMIT = Number(process.env.RATE_LIMIT_LOGIN_PER_MINUTE ?? 5);
export const API_LIMIT = Number(process.env.RATE_LIMIT_API_PER_MINUTE ?? 120);
