/**
 * Prints one JSON line about the database in $DATABASE_URL: reachable, and how many migrations are applied compared
 * with how many this version of Verid ships. Used by `pnpm predeploy`. Read-only; prints no secrets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { createPgDb } from "../src/db/client";

const out = (o: unknown) => console.log(JSON.stringify(o));
const url = process.env.DATABASE_URL;
if (!url) {
  out({ ok: false, error: "DATABASE_URL is not set" });
} else {
  try {
    const handle = await createPgDb(url, { migrate: false });
    await handle.db.execute(sql`select 1`);
    const journal = (JSON.parse(readFileSync(resolve(import.meta.dirname, "../migrations/meta/_journal.json"), "utf8")).entries as unknown[]).length;
    let applied = 0;
    try {
      const r = (await handle.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { rows?: { n: number }[] } | { n: number }[];
      applied = Array.isArray(r) ? r[0]?.n ?? 0 : r.rows?.[0]?.n ?? 0;
    } catch {
      applied = 0; // the migrations table does not exist yet
    }
    await handle.close();
    out({ ok: true, applied, journal });
  } catch (e) {
    out({ ok: false, error: (e as Error).message.split("\n")[0] });
  }
}
