interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

class SlidingWindowRateLimiter {
  private windows = new Map<string, number[]>();

  check(key: string, config: RateLimitConfig): RateLimitResult {
    this.prune(key, config.windowMs);

    const timestamps = this.windows.get(key) ?? [];
    if (timestamps.length >= config.maxRequests) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + config.windowMs - Date.now();
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
    }

    return { allowed: true };
  }

  record(key: string): void {
    const timestamps = this.windows.get(key) ?? [];
    timestamps.push(Date.now());
    this.windows.set(key, timestamps);
  }

  private prune(key: string, windowMs: number): void {
    const timestamps = this.windows.get(key);
    if (!timestamps) return;

    const cutoff = Date.now() - windowMs;
    const pruned = timestamps.filter((t) => t > cutoff);

    if (pruned.length === 0) {
      this.windows.delete(key);
    } else {
      this.windows.set(key, pruned);
    }
  }
}

const PER_USER_CONFIG: RateLimitConfig = { windowMs: 60_000, maxRequests: 5 };
const GLOBAL_CONFIG: RateLimitConfig = { windowMs: 60_000, maxRequests: 30 };

const perUserLimiter = new SlidingWindowRateLimiter();
const globalLimiter = new SlidingWindowRateLimiter();

export function checkRateLimit(chatId: number): RateLimitResult {
  const userKey = String(chatId);

  // Check per-user first
  const userResult = perUserLimiter.check(userKey, PER_USER_CONFIG);
  if (!userResult.allowed) return userResult;

  // Check global
  const globalResult = globalLimiter.check("global", GLOBAL_CONFIG);
  if (!globalResult.allowed) return globalResult;

  // Record both
  perUserLimiter.record(userKey);
  globalLimiter.record("global");

  return { allowed: true };
}
