import { config } from "dotenv";
// Tests always run against the dedicated local test database (.env.test), never Supabase.
config({ path: [".env.test"], quiet: true, override: true });
