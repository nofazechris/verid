import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Driver-agnostic Drizzle database: PGlite (dev/test) and node-postgres (prod) both satisfy it. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Default migrations location, valid when running from source (tests, scripts).
 * Bundled apps (Next.js) MUST pass `migrationsFolder` explicitly: after bundling,
 * this module's location no longer matches the package layout. (Built with path
 * joins rather than `new URL(..., import.meta.url)`, which bundlers treat as an asset import.)
 */
export const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

/**
 * In-process Postgres (PGlite). Real Postgres semantics, no external server:
 * used for tests and zero-setup local development. Pass `dataDir` to persist.
 */
export async function createPgliteDb(dataDir?: string, opts: { migrationsFolder?: string } = {}): Promise<DbHandle> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: opts.migrationsFolder ?? MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, close: () => client.close() };
}

/** Production Postgres (e.g. Neon) via a connection string. Runs migrations only when asked. */
export async function createPgDb(connectionString: string, opts: { migrate?: boolean; migrationsFolder?: string } = {}): Promise<DbHandle> {
  const [{ default: pg }, { drizzle }, { migrate }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  if (opts.migrate) await migrate(db, { migrationsFolder: opts.migrationsFolder ?? MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, close: () => pool.end() };
}

export { schema };
