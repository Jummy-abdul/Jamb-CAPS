/**
 * Read-only database check. Prints connection kinds and schema/data status;
 * never prints connection strings or passwords.
 *
 *   npm run db:check
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import postgres from "postgres";
import { describeConnection, sslFor } from "../src/lib/db/connection";

async function probe(label: string, url: string | undefined, expected: string[]) {
  if (!url) {
    console.log(`• ${label}: not set`);
    return;
  }
  const { kind, host, port } = describeConnection(url);
  const ok = expected.includes(kind) || kind === "local";
  console.log(`• ${label}: ${kind} (${host}:${port})${ok ? "" : `  ⚠ expected ${expected.join(" or ")}`}`);
  const sql = postgres(url, { max: 1, prepare: false, ssl: sslFor(url), connect_timeout: 10, onnotice: () => {} });
  try {
    const [{ version }] = await sql`select current_setting('server_version') as version`;
    console.log(`    connected · PostgreSQL ${version}`);
    const [m] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
    if (!m.present) {
      console.log("    migrations: none applied yet (run npm run db:migrate)");
      return;
    }
    const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    const [c] = await sql`select
        (select count(*)::int from application_roles) as roles,
        (select count(*)::int from role_mappings) as mappings,
        (select count(*)::int from applicants) as applicants,
        (select count(*)::int from users where provisioning_source = 'scim' and deleted_at is null) as scim_users,
        (select count(*)::int from groups where deleted_at is null) as groups,
        (select count(*)::int from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_without_rls`;
    console.log(`    migrations applied: ${n} · roles: ${c.roles} · role mappings: ${c.mappings}`);
    console.log(`    sample applicants: ${c.applicants} · groups: ${c.groups} · Fixiam-provisioned users: ${c.scim_users}`);
    console.log(`    tables without RLS: ${c.tables_without_rls}${c.tables_without_rls === 0 ? " ✓" : " ⚠"}`);
  } catch (e) {
    console.log(`    ✗ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

(async () => {
  await probe("MIGRATION_DATABASE_URL", process.env.MIGRATION_DATABASE_URL, ["session_pooler", "direct"]);
  await probe("DATABASE_URL (runtime)", process.env.DATABASE_URL, ["transaction_pooler"]);
})();
