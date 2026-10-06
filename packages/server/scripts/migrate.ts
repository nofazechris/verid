/**
 * Apply migrations to a real Postgres (run as a deploy step):
 *   DATABASE_URL=postgres://... pnpm --filter @verid/server db:migrate
 */
import { createPgDb } from "../src/db/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const { close } = await createPgDb(url, { migrate: true });
await close();
console.log("migrations applied");
