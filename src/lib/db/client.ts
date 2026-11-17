import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbEnv } from "@/lib/env";
import { describeConnection, sslFor } from "./connection";
import * as schema from "./schema";

/**
 * Server-only PostgreSQL connection (Supabase) for the application runtime.
 *
 * DATABASE_URL should be Supabase's *Transaction pooler* connection string
 * (port 6543), which suits short-lived serverless functions on Vercel.
 *  - prepare: false — the transaction pooler (Supavisor, transaction mode) does
 *    not support prepared statements, so postgres.js must not create them.
 *  - TLS is required for remote databases.
 *  - A small pool per function instance; the pooler multiplexes connections.
 * The client is cached on globalThis so warm invocations and dev hot reloads reuse it.
 */
type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __capsSql?: postgres.Sql; __capsDb?: Db; __capsDbWarned?: boolean };

function create(): Db {
  const { DATABASE_URL } = getDbEnv();
  const { kind } = describeConnection(DATABASE_URL);
  if (process.env.VERCEL && kind !== "transaction_pooler" && !globalForDb.__capsDbWarned) {
    globalForDb.__capsDbWarned = true;
    console.warn(`[db] DATABASE_URL is a ${kind} connection; on Vercel use the Supabase Transaction pooler (port 6543).`);
  }
  const sql = postgres(DATABASE_URL, {
    prepare: false,
    ssl: sslFor(DATABASE_URL),
    max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 3 : 5)),
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
