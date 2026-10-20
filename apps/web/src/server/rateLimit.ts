/**
 * Fixed-window, in-memory rate limiter for public deployments. Per process: good enough for the single
 * Node server this app runs as; a multi-instance deployment needs a shared store instead.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (windows.size > 10_000) for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (w.count >= limit) return { ok: false, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
  w.count++;
  return { ok: true };
}

export function resetRateLimits() {
  windows.clear();
}

/** Client IP as reported by the reverse proxy in front of the app (first X-Forwarded-For hop). */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
