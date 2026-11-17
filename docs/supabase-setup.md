# Supabase setup for CAPS

CAPS uses two Supabase connection strings for **the same database**:

| Variable | Supabase connection | Port | Used by | Where it is set |
|---|---|---|---|---|
| `DATABASE_URL` | **Transaction pooler** | 6543 | The app at runtime on Vercel (serverless) | Vercel environment variables |
| `MIGRATION_DATABASE_URL` | **Session pooler** (or direct connection) | 5432 | `npm run db:migrate`, `npm run db:seed`, `npm run db:check` | Your machine only (`.env.local` or shell) |

* The runtime client disables prepared statements (`prepare: false`), which the transaction pooler
  requires, and enforces TLS.
* The migration and seed scripts **refuse** a transaction-pooler URL, because DDL and multi-statement
  migrations need a session connection.
* No command prints a connection string or password. Never paste them into chat, tickets or commits;
  `.env*` files (except `.env.example`) are git-ignored.

## 1. Create the project

1. Supabase dashboard → **New project** → name **`jamb-caps-demo`**.
2. Generate a strong database password and store it in your password manager.
3. Choose a region close to the demo audience and to the Vercel deployment region (e.g. *West EU*).

## 2. Get the connection strings

Project → **Connect** (top bar) → **Connection string** → type **URI**:

* **Transaction pooler** →
  `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres`
* **Session pooler** →
  `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`

Replace `[YOUR-PASSWORD]` with the database password. If the password contains special characters
(`@ : / ? # % &` …), URL-encode them (e.g. `@` → `%40`), or use a password made only of letters and digits.

## 3. Run migrations and seed (from your machine)

Prerequisites: Node.js 20.9+ and a clone of the repository.

```bash
git clone https://github.com/Jummy-abdul/Jamb-CAPS.git
cd Jamb-CAPS
git checkout claude/exciting-davinci-lgnz0w   # or main after the PR is merged
npm install
```

Put the **Session pooler** string in `.env.local` (git-ignored) with an editor, so it never appears in
your shell history:

```bash
cp .env.example .env.local
# edit .env.local and set MIGRATION_DATABASE_URL=<Session pooler URI>
```

Alternatively, for a one-off session, enter it at a hidden prompt:

```bash
read -rs MIGRATION_DATABASE_URL && export MIGRATION_DATABASE_URL
```

Then run:

```bash
npm run db:migrate   # creates tables, constraints, indexes, RLS, roles, permissions, default group mappings
npm run db:seed      # fictional institutions/applicants, sample staff, pre-existing CAPS groups
npm run db:check     # read-only verification
```

Expected `db:check` output (values may differ slightly):

```
• MIGRATION_DATABASE_URL: session_pooler (aws-0-<region>.pooler.supabase.com:5432)
    connected · PostgreSQL 17.x
    migrations applied: 2 · roles: 3 · role mappings: 3
    sample applicants: 120 · groups: 3 · Fixiam-provisioned users: 0
    tables without RLS: 0 ✓
• DATABASE_URL (runtime): not set
```

To also verify the runtime connection, set `DATABASE_URL` to the **Transaction pooler** URI in
`.env.local` and run `npm run db:check` again; it should report `transaction_pooler` and the same counts.

All three commands are safe to re-run: applied migrations are skipped and the seed does nothing if
data already exists (`npm run db:seed -- --reset` recreates only the fictional applicant data and
sample staff).

## 4. Configure Vercel

Vercel → Project → **Settings → Environment Variables** — add for **Production** and **Preview**:

* `DATABASE_URL` = Transaction pooler URI (port 6543)
* plus `SESSION_SECRET`, `SCIM_TOKEN` and the `FIXIAM_*` variables (see README)

`MIGRATION_DATABASE_URL` is **not** needed in Vercel.

After deploying, `GET https://<host>/api/health` reports whether the database is configured
(`"database": true`) without exposing any values.

## Security notes

* Row Level Security is enabled on every table with no policies, so Supabase's public REST/GraphQL
  APIs (`anon` / `authenticated` roles) cannot read or modify CAPS data. CAPS never uses the
  Supabase anon or service-role keys.
* The audit log is append-only (database trigger).
* If a connection string is ever exposed, reset the database password in Supabase
  (**Project Settings → Database → Reset database password**) and update `.env.local` and Vercel.
