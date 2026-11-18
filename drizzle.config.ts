import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is used to *generate* SQL migrations from src/lib/db/schema.ts
 * (`npm run db:generate`, no database needed) and for `npm run db:studio`.
 *
 * Migrations are *applied* with `npm run db:migrate` (scripts/migrate.ts), which
 * enforces the Supabase Session pooler / direct connection (MIGRATION_DATABASE_URL).
 */
function studioUrl() {
  const url = process.env.MIGRATION_DATABASE_URL || "";
  if (!url || /localhost|127\.0\.0\.1/.test(url) || url.includes("sslmode=")) return url;
  return url + (url.includes("?") ? "&" : "?") + "sslmode=require";
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: studioUrl() },
  strict: true,
  verbose: true,
});
