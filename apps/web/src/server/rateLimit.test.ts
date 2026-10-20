import { beforeEach, describe, expect, it } from "vitest";
import { clientIp, rateLimit, resetRateLimits } from "./rateLimit";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit per window, then reports when to retry", () => {
    expect(rateLimit("k", 2, 60_000, 0)).toEqual({ ok: true });
    expect(rateLimit("k", 2, 60_000, 1)).toEqual({ ok: true });
    expect(rateLimit("k", 2, 60_000, 30_000)).toEqual({ ok: false, retryAfterSec: 30 });
    expect(rateLimit("other", 2, 60_000, 30_000)).toEqual({ ok: true });
    expect(rateLimit("k", 2, 60_000, 60_000)).toEqual({ ok: true });
  });

  it("keys by the first forwarded hop", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }))).toBe("203.0.113.5");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
