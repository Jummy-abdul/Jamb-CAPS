/**
 * Apply database migrations from ./drizzle using MIGRATION_DATABASE_URL
 * (Supabase Session pooler or direct connection — never the Transaction pooler).
 *
 *   npm run db:migrate
 *
 * Idempotent: already-applied migrations are skipped (tracked in drizzle.__drizzle_migrations).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describeConnection, requireMigrationUrl, sslFor } from "../src/lib/db/connection";

async function main() {
  const url = requireMigrationUrl();
  const { kind, host } = describeConnection(url);
  console.log(`Applying migrations via ${kind} (${host})…`);
  const client = postgres(url, { max: 1, ssl: sslFor(url), onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    const [{ n }] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
    console.log(`✓ Migrations up to date (${n} applied).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`✗ Migration failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
