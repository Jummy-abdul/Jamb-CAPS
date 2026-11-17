# CAPS – Central Admission Processing System

**Admissions Administration and Processing Portal — Fixiam IAM demonstration**

> ⚠️ **Demonstration environment.** CAPS is a simulated third-party enterprise application built to
> demonstrate the identity and access management capabilities of **Fixiam** (Seamfix). It is **not**
> an official system of the Joint Admissions and Matriculation Board (JAMB). All applicants,
> institutions, application numbers and sample staff records are fictional.

CAPS consumes identities and access assignments from Fixiam:

| Capability | Mechanism |
|---|---|
| Automatic user provisioning | Fixiam → CAPS over **SCIM 2.0** (`/scim/v2/Users`) |
| Group management & import | Fixiam ↔ CAPS over **SCIM 2.0** (`/scim/v2/Groups`) |
| Single Sign-On | **OpenID Connect** Authorization Code Flow + PKCE; Fixiam is the IdP |
| Centralised roles & permissions | Fixiam-synchronised group membership → configurable role mappings → backend-enforced permissions |
| Access lifecycle & revocation | SCIM deactivation / deprovisioning / membership removal → immediate session revalidation |
| Audit | Every provisioning, group, role, authentication, session, authorization and admission event |

Detailed docs: **[Fixiam integration guide](docs/fixiam-integration.md)** · **[Supabase setup](docs/supabase-setup.md)** · **[Demonstration runbook](docs/demo-runbook.md)**

---

## Architecture

```
            ┌──────────────── Fixiam (IdP / IAM) ────────────────┐
            │ identities · app assignment · groups · entitlements │
            └──────┬──────────────────────────────────┬──────────┘
     OIDC (browser)│ Auth Code + PKCE        SCIM 2.0 │ Bearer (server → server)
                   ▼                                  ▼
┌──────────────────────── CAPS · Next.js on Vercel ────────────────────────┐
│ /api/auth/*  → lib/auth   (discovery, JWKS, state/nonce/PKCE, sessions)   │
│ /scim/v2/*   → lib/scim   (filters, PATCH, users, groups, sync log)       │
│ pages + /api → lib/authz  (per-request principal, deny-by-default)        │
│               lib/audit   (append-only audit trail)                       │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ server-only Postgres (Drizzle ORM)
                                   ▼
                     Supabase PostgreSQL (RLS: API roles denied)
```

| Component | Responsibility |
|---|---|
| GitHub | Source code repository |
| Next.js 16 (App Router, TypeScript, Tailwind CSS v4) | UI, route handlers, SCIM service provider, OIDC client |
| Supabase PostgreSQL | Persistent data: users, groups, memberships, entitlements, sessions, admissions, audit |
| Drizzle ORM + `postgres` driver | Server-only typed database access and migrations |
| Vercel | Hosting and deployment |
| Fixiam | Identity provider; authoritative source of identities and access assignments |

**Design principles**

* **Fixiam is the source of truth.** CAPS has no passwords and does not use Supabase Auth.
* **Provisioning gates sign-in.** Only users Fixiam provisioned over SCIM, and who are active, can sign in.
* **Group membership drives roles.** Fixiam groups → configurable mappings → CAPS roles → permissions.
  Users cannot assign themselves roles; administrators cannot change mappings that affect their own access.
* **Every request is re-validated** (session, account state, effective permissions); nothing
  identity-related is cached. Deactivation revokes sessions immediately.
* **Backend enforcement, deny by default.** The UI hides what you cannot do; the server refuses it.
* **Secrets stay on the server.** Database, OIDC and SCIM credentials exist only in server environment
  variables; Supabase's public API is locked down with Row Level Security.

## Modules

Dashboard · Applicants · Application Review · Admission Decisions · User Directory · Groups & Access ·
Role & Permission Mapping · SCIM Sync Logs · Audit Logs · Integration Settings

| Role (via Fixiam group) | Can |
|---|---|
| Admission Officer (`CAPS Admission Officers`) | View applicants and profiles, review applications, add notes |
| Admission Manager (`CAPS Admission Managers`) | Officer rights + approve, reject, hold admissions, view reports |
| System Administrator (`CAPS System Administrators`) | Records, user directory, groups, role mappings, SCIM logs, audit logs, integration settings |

## Project structure

```
src/
  app/
    (portal)/…            authenticated UI pages
    login/                Fixiam sign-in page (the only sign-in)
    api/auth/             login · callback · logout (OIDC)
    api/applications/     review / decision APIs (permission-checked)
    api/admin/            role mappings · OIDC discovery check
    scim/v2/              Users · Groups · ServiceProviderConfig · ResourceTypes · Schemas
  components/             layout, UI primitives, feature components
  lib/
    env.ts                validated server-only configuration
    db/                   Drizzle schema + client
    auth/                 OIDC client, identity linking, sessions
    authz/                principal resolution, permissions, entitlements, mappings
    scim/                 filter parser, SQL translation, PATCH engine, resources, handler
    audit/                audit writer (with secret redaction)
    data/                 page queries and admission actions
drizzle/                  SQL migrations (schema, RLS, reference data, default mappings)
scripts/                  seed.ts · dev-idp.mjs (local TEST IdP) · reset-local-db.sh
tests/                    unit + DB integration tests · e2e/demo-scenarios.mjs
docs/                     integration guide · demo runbook
```

## Database (Supabase)

Full step-by-step guide: **[docs/supabase-setup.md](docs/supabase-setup.md)**.

| Variable | Supabase connection | Used by |
|---|---|---|
| `DATABASE_URL` | Transaction pooler (port 6543) | App runtime on Vercel; prepared statements disabled, TLS enforced |
| `MIGRATION_DATABASE_URL` | Session pooler (port 5432) or direct | `npm run db:migrate`, `db:seed`, `db:check` — on your machine only |

```bash
npm run db:migrate   # schema, RLS, roles, permissions, default group mappings (idempotent)
npm run db:seed      # fictional demo data + pre-existing CAPS groups (idempotent)
npm run db:check     # read-only verification; never prints connection strings
```

The migration scripts refuse a transaction-pooler URL. Migrations enable RLS on every table (no
policies → Supabase's `anon`/`authenticated` API roles are denied) and make `audit_logs` append-only.

Tables: `users`, `groups`, `group_memberships`, `application_roles`, `permissions`,
`role_permissions`, `role_mappings`, `user_entitlements`, `user_sessions`, `oidc_transactions`,
`institutions`, `programmes`, `applicants`, `admission_applications`, `admission_reviews`,
`admission_decisions`, `audit_logs`, `scim_sync_logs`.

## Environment variables

All server-side only (never `NEXT_PUBLIC_`). See [`.env.example`](.env.example).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase transaction-pooler connection string |
| `MIGRATION_DATABASE_URL` | Supabase session-pooler connection string (migrations/seed/check, local machine only — not needed in Vercel) |
| `SESSION_SECRET` | ≥ 32 random chars; keys the HMAC of session tokens (`openssl rand -base64 48`) |
| `SESSION_MAX_AGE_MINUTES` / `SESSION_IDLE_TIMEOUT_MINUTES` | Defaults 480 / 60 |
| `FIXIAM_ISSUER_URL` | Fixiam OIDC issuer; discovery is read from it |
| `FIXIAM_CLIENT_ID` / `FIXIAM_CLIENT_SECRET` | Issued by Fixiam |
| `FIXIAM_REDIRECT_URI` | `https://<host>/api/auth/callback` |
| `FIXIAM_POST_LOGOUT_REDIRECT_URI` | `https://<host>/login` |
| `FIXIAM_SCOPES` | Default `openid profile email` |
| `FIXIAM_TOKEN_AUTH_METHOD` | `client_secret_basic` (default) or `client_secret_post` |
| `SCIM_TOKEN` | ≥ 32 chars bearer token for Fixiam SCIM (`openssl rand -hex 32`) |
| `OIDC_ALLOW_INSECURE_LOCALHOST` | Local testing only: allow an `http://localhost` issuer. Never set in production. |

## OIDC and SCIM configuration

See **[docs/fixiam-integration.md](docs/fixiam-integration.md)**. In short:

* Fixiam OIDC client → redirect URI `https://<host>/api/auth/callback`, post-logout `https://<host>/login`.
* Fixiam SCIM connector → base URL `https://<host>/scim/v2`, header `Authorization: Bearer <SCIM_TOKEN>`.
* CAPS **Integration Settings** shows these values for the running deployment and can verify
  Fixiam's discovery document.

## Deployment (Vercel)

1. Vercel → **Add New Project** → import this GitHub repository (framework preset: Next.js).
2. Add the environment variables above for **Production** (and Preview if used).
3. Deploy, then note the production URL and update `FIXIAM_REDIRECT_URI` /
   `FIXIAM_POST_LOGOUT_REDIRECT_URI`, then redeploy.
4. **Deployment Protection:** Fixiam must reach `/scim/v2/*` and browsers must reach
   `/api/auth/*` without Vercel authentication. Use the production domain, or disable
   protection for the deployment Fixiam calls.
5. Verify `https://<host>/api/health`, then configure Fixiam (section above).

## Local development and testing

```bash
npm install
cp .env.example .env.local            # fill in values (local Postgres or Supabase)
npm run db:migrate && npm run db:seed
npm run dev
```

**Without Fixiam** you can exercise the full flow with the bundled local **test** OpenID Provider
(`scripts/dev-idp.mjs`, a standards-compliant provider used for automated testing; it is not Fixiam):

```bash
node scripts/dev-idp.mjs   # http://localhost:4400, client caps-local / caps-local-secret-for-dev-idp-only
# .env.local: FIXIAM_ISSUER_URL=http://localhost:4400, FIXIAM_CLIENT_ID=caps-local,
#             FIXIAM_CLIENT_SECRET=caps-local-secret-for-dev-idp-only, OIDC_ALLOW_INSECURE_LOCALHOST=true
```

**Automated tests**

| Command | Covers |
|---|---|
| `npm run typecheck` / `npm run lint` | Types and lint |
| `npm test` | SCIM filter parser and PATCH engine (unit); SCIM Users/Groups lifecycle, uniqueness, filtering, pagination, membership → roles, session revalidation and revocation, deprovisioning (integration, against the Postgres DB in `.env.test`) |
| `node tests/e2e/demo-scenarios.mjs` | All five demonstration scenarios in a real browser against a running instance (SCIM + OIDC + UI + API enforcement + audit) |

`.env.test` (git-ignored) must point at a disposable local database, e.g.
`DATABASE_URL=postgres://…@localhost:5432/caps_test`; migrate it with
`MIGRATION_DATABASE_URL=<same URL> npm run db:migrate`. Tests truncate tables — never point them at Supabase.

## Security summary

* OIDC: PKCE (S256), state, nonce, browser-bound single-use login transaction, server-side code
  exchange, ID-token signature/issuer/audience/expiry/nonce validation, open-redirect protection.
* Sessions: opaque 256-bit token in an `HttpOnly; Secure; SameSite=Lax` `__Host-` cookie; only an
  HMAC is stored; absolute and idle timeouts; revoked on deactivation, deprovisioning and logout.
* Authorization: one central service, evaluated per request, deny by default; denials audited.
* SCIM: constant-time bearer token comparison; strict input validation; whitelisted filter attributes
  with parameterised SQL; sensitive attributes redacted from logs.
* State-changing APIs require same-origin requests. Security headers (HSTS, frame denial, nosniff,
  referrer policy, CSP frame-ancestors).
* Database: server-only access, RLS deny-all for Supabase API roles, unique constraints, foreign keys,
  append-only audit trigger.

## Known limitations

* Time-based expiry is enforced when Fixiam sends the corresponding SCIM change (deactivation,
  deletion or membership removal). CAPS does not simulate upstream expiry. See the integration guide.
* OIDC back-channel logout is not implemented (sessions are revoked through SCIM lifecycle events).
* SCIM bulk operations, sorting and ETag preconditions are not supported (advertised as such in
  `ServiceProviderConfig`).
