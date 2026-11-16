import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from src/lib/db/schema.ts into ./drizzle and applied
 * with `npm run db:migrate`.
 *
 * For migrations use Supabase's *session pooler* or direct connection string
 * (MIGRATION_DATABASE_URL); the app itself uses the transaction pooler.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
  },
  strict: true,
  verbose: true,
});
