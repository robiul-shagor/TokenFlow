import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: 5, onnotice: () => {} });
  return { db: drizzle({ client, schema }), close: () => client.end() };
}

const globalForDb = globalThis as unknown as { tokenflowDb?: Db };

/** Process-wide connection (reused across Next.js dev hot reloads). */
export function getDb(): Db {
  if (!globalForDb.tokenflowDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
    globalForDb.tokenflowDb = createDb(url).db;
  }
  return globalForDb.tokenflowDb;
}
