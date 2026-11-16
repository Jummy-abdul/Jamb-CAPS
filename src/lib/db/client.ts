import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Server-only PostgreSQL connection (Supabase).
 *
 * On Vercel use Supabase's *transaction pooler* connection string (port 6543).
 * Prepared statements are disabled because the transaction pooler does not
 * support them. The client is cached on globalThis so serverless warm starts
 * and dev hot-reloads reuse one small pool.
 */
type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __capsSql?: postgres.Sql; __capsDb?: Db };

function create(): Db {
  const { DATABASE_URL } = getDbEnv();
  const sql = postgres(DATABASE_URL, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  globalForDb.__capsSql = sql;
  return drizzle(sql, { schema });
}

export function getDb(): Db {
  if (!globalForDb.__capsDb) globalForDb.__capsDb = create();
  return globalForDb.__capsDb;
}

export type Database = Db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
