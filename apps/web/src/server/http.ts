import { ConfigError, networkProfile } from "./config";
import { clientIp, rateLimit } from "./rateLimit";

export function jsonError(status: number, error: string, details?: unknown): Response {
  return Response.json({ error, ...(details === undefined ? {} : { details }) }, { status });
}

/** Map thrown errors to safe JSON responses. Internal details are logged server-side only. */
export function handleRouteError(err: unknown): Response {
  if (err instanceof ConfigError) return jsonError(503, err.message);
  console.error("[api]", err);
  const msg = (err as Error)?.message ?? "";
  if (/ECONNREFUSED|connect|DATABASE_URL/i.test(msg)) {
    return jsonError(503, "A local dependency (database or RPC) is unavailable");
  }
  return jsonError(500, "Internal error");
}

/** Read a request body as text with a hard size limit. */
export async function readLimitedText(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  const text = await req.text();
  return new TextEncoder().encode(text).length > maxBytes ? null : text;
}

/**
 * Per-IP rate limit for write-ish endpoints on public networks (no-op on the local profile).
 * Returns a 429 response to send, or null to continue.
 */
export function limitPublicRequest(req: Request, bucket: string, perMinute: number): Response | null {
  if (networkProfile().kind === "local") return null;
  const r = rateLimit(`${bucket}:${clientIp(req)}`, perMinute, 60_000);
  if (r.ok) return null;
  return Response.json(
    { error: "Too many requests; try again shortly" },
    { status: 429, headers: { "retry-after": String(r.retryAfterSec) } },
  );
}
