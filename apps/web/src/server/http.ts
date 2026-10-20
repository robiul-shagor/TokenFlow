import { ConfigError } from "./config";

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
