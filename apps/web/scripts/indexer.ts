import "./env";
import { createDb } from "../src/db/client";
import { ChainMismatchError, indexToHead, recordIndexerError, resetIndex, withRetry } from "../src/indexer/indexer";
import { assertLocalChain, getPublicClient, loadDeployment } from "../src/server/config";

async function main() {

  const args = new Set(process.argv.slice(2));
  const once = args.has("--once");
  const reset = args.has("--reset");
  const intervalMs = Number(process.env.INDEXER_POLL_MS ?? 2_000);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy apps/web/.env.example to apps/web/.env.local)");

  const deployment = loadDeployment();
  const client = getPublicClient();
  await assertLocalChain(client);
  const { db, close } = createDb(url);
  const target = { chainId: deployment.chainId, registry: deployment.registry, deployBlock: deployment.deployBlock };

  if (reset) {
    await resetIndex(db, target);
    console.log(`[indexer] reset index for ${deployment.registry} on chain ${deployment.chainId}`);
  }

  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));

  console.log(`[indexer] LOCAL DEVELOPMENT ONLY — indexing ${deployment.registry} (chain ${deployment.chainId})`);
  do {
    try {
      const results = await withRetry(() => indexToHead({ ...target, db, client }), {
        onRetry: (err, n) => console.warn(`[indexer] transient error, retry ${n}: ${(err as Error).message}`),
      });
      const inserted = results.reduce((s, r) => s + r.eventsInserted, 0);
      const last = results.at(-1)!;
      if (inserted > 0 || once) {
        console.log(`[indexer] head ${last.headBlock}, ${inserted} new event(s)`);
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[indexer] ${message}`);
      await recordIndexerError(db, target, message).catch(() => {});
      if (err instanceof ChainMismatchError || once) {
        await close();
        process.exit(1);
      }
    }
    if (!once && !stopping) await new Promise((r) => setTimeout(r, intervalMs));
  } while (!once && !stopping);

  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
