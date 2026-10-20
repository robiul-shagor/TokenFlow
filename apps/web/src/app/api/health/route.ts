import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { loadDeployment, networkProfile, validateEnv } from "@/server/config";
import { getIndexingMeta } from "@/server/snapshot";

/** App, database, RPC and indexer status. Always 200 with per-component detail unless the app itself is broken. */
export async function GET() {
  await connection();
  const problems = validateEnv();
  if (problems.length > 0) {
    // Names of missing/invalid settings only; values are never echoed.
    return Response.json({ app: "misconfigured", problems }, { status: 503 });
  }
  const network = networkProfile();
  let deployment;
  try {
    deployment = loadDeployment();
  } catch (err) {
    return Response.json({ app: "ok", deployment: { ok: false, error: (err as Error).message } }, { status: 503 });
  }
  let database: { ok: boolean; error?: string } = { ok: true };
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    database = { ok: false, error: "Database unavailable" };
  }
  const indexing = database.ok ? await getIndexingMeta(getDb(), deployment).catch(() => null) : null;
  const ok = database.ok && indexing !== null && indexing.headBlock !== null;
  return Response.json(
    { app: "ok", network: { name: network.name, chainId: network.chain.id }, deployment: { ok: true }, database, indexing },
    { status: ok ? 200 : 503 },
  );
}
