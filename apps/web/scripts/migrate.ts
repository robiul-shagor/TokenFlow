import "./env";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db/client";

async function main() {

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy apps/web/.env.example to apps/web/.env.local)");
  const { db, close } = createDb(url);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await close();
  console.log("Database migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
