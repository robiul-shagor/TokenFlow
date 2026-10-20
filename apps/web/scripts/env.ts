import { existsSync } from "node:fs";

// Load apps/web/.env.local (and .env) for CLI scripts the same way Next.js does for the app.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
