/**
 * Connection-string helpers shared by the app runtime and the CLI scripts
 * (migrate, seed, db:check). No secrets are ever logged: only the connection
 * *kind* and host are reported.
 *
 * Supabase offers three ways to connect:
 *   - Transaction pooler  aws-0-<region>.pooler.supabase.com:6543  → Vercel runtime (DATABASE_URL)
 *   - Session pooler      aws-0-<region>.pooler.supabase.com:5432  → migrations/seed (MIGRATION_DATABASE_URL)
 *   - Direct connection   db.<project-ref>.supabase.co:5432         → migrations/seed (IPv6 only on some plans)
 *
 * The transaction pooler does not support prepared statements or session-level
 * features, so the runtime client disables prepared statements and migrations
 * must not run through it.
 */

export type ConnectionKind = "transaction_pooler" | "session_pooler" | "direct" | "local" | "other";

export function describeConnection(url: string): { kind: ConnectionKind; host: string; port: number } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Database connection string is not a valid URL (expected postgresql://user:password@host:port/database).");
  }
  const host = u.hostname;
  const port = Number(u.port || 5432);
  let kind: ConnectionKind = "other";
  if (["localhost", "127.0.0.1", "::1"].includes(host)) kind = "local";
  else if (host.endsWith(".pooler.supabase.com")) kind = port === 6543 ? "transaction_pooler" : "session_pooler";
  else if (host.endsWith(".supabase.co")) kind = "direct";
  else if (port === 6543) kind = "transaction_pooler";
  return { kind, host, port };
}

/** Remote databases (Supabase) require TLS; local development databases do not. */
export function sslFor(url: string): "require" | false {
  const u = new URL(url);
  const mode = u.searchParams.get("sslmode");
  if (mode === "disable") return false;
  return describeConnection(url).kind === "local" ? false : "require";
}

/**
 * Connection string for migrations and seeding. Requires MIGRATION_DATABASE_URL
 * (session pooler or direct connection) and refuses the transaction pooler.
 * Falls back to DATABASE_URL only for a local development database.
 */
export function requireMigrationUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.MIGRATION_DATABASE_URL?.trim() || (env.DATABASE_URL && describeConnection(env.DATABASE_URL).kind === "local" ? env.DATABASE_URL : "");
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL is not set. Use the Supabase *Session pooler* connection string (port 5432) " +
        "for migrations and seeding. Set it in .env.local or in your shell — never commit it.",
    );
  }
  const { kind } = describeConnection(url);
  if (kind === "transaction_pooler") {
    throw new Error(
      "MIGRATION_DATABASE_URL points at the Supabase *Transaction pooler* (port 6543). Migrations must use the " +
        "*Session pooler* (port 5432) or the direct connection. The transaction pooler is for the app runtime (DATABASE_URL).",
    );
  }
  return url;
}
