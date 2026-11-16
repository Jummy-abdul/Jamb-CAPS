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
| Single Sign-On | **OpenID Connect** Authorization Code Flow + PKCE (Fixiam is the IdP) |
| Centralised roles & permissions | Fixiam-synchronised group membership → configurable role mappings → backend-enforced permissions |
| Access lifecycle & revocation | SCIM deactivation / deprovisioning / membership removal → immediate session revalidation |
| Audit | Every provisioning, authentication, authorization and admission event is recorded |

---

## Architecture

| Component | Responsibility |
|---|---|
| GitHub | Source code repository |
| Next.js 16 (App Router, TypeScript, Tailwind CSS) | UI, route handlers, SCIM service provider, OIDC client |
| Supabase PostgreSQL | Persistent application data (users, groups, memberships, sessions, admissions, audit) |
| Drizzle ORM + `postgres` driver | Server-only typed database access |
| Vercel | Hosting and deployment |
| Fixiam | Identity provider and authoritative source of identities and access assignments |

Design principles:

* **Fixiam is the source of truth** for identities, authentication and group/role assignment. CAPS has
  no local passwords and does not use Supabase Auth.
* **Provisioning gates login.** A Fixiam user can sign in to CAPS only after Fixiam has provisioned
  them over SCIM and while their CAPS account is active.
* **Every request is re-validated** against the database (session, account status, effective
  permissions), so access withdrawn in Fixiam takes effect on the next request.
* **Backend-enforced, deny-by-default authorization** through one central service.
* **Secrets never reach the browser.** The database is accessed only from the server; Supabase's
  public REST API is locked down with Row Level Security (deny-all).

See [`docs/`](docs/) for the detailed integration guide and demonstration runbook (added in later phases).

## Project structure

```
src/
  app/                 Next.js routes (UI pages, /api/*, /scim/v2/*)
  components/          UI components (layout, tables, badges, dialogs)
  lib/
    env.ts             Validated server-only configuration
    db/                Drizzle schema and client
    auth/              Fixiam OIDC client and session management
    authz/             Central authorization service (roles, permissions, mappings)
    scim/              SCIM 2.0 service provider (filters, PATCH, errors, mappers)
    audit/             Audit logging
drizzle/               SQL migrations
scripts/               Seed and maintenance scripts
tests/                 Unit and integration tests
docs/                  Integration and demo documentation
```

## Local development

Prerequisites: Node.js 20.9+ (22 recommended), a PostgreSQL database (Supabase or local).

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run db:migrate           # apply migrations
npm run db:seed              # load fictional demo data
npm run dev
```

## Environment variables

See [`.env.example`](.env.example). All variables are server-side only.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase transaction-pooler connection string (runtime) |
| `MIGRATION_DATABASE_URL` | Supabase session-pooler/direct connection string (migrations, seeding) |
| `SESSION_SECRET` | Secret used to protect session tokens (≥ 32 chars) |
| `SESSION_MAX_AGE_MINUTES`, `SESSION_IDLE_TIMEOUT_MINUTES` | Session lifetime controls |
| `FIXIAM_ISSUER_URL` | Fixiam OIDC issuer (discovery document is read from it) |
| `FIXIAM_CLIENT_ID`, `FIXIAM_CLIENT_SECRET` | OIDC client credentials issued by Fixiam |
| `FIXIAM_REDIRECT_URI` | `https://<host>/api/auth/callback` |
| `FIXIAM_POST_LOGOUT_REDIRECT_URI` | `https://<host>/login` |
| `FIXIAM_SCOPES` | Default `openid profile email` |
| `FIXIAM_TOKEN_AUTH_METHOD` | `client_secret_basic` or `client_secret_post` |
| `SCIM_TOKEN` | Bearer token Fixiam uses to call `/scim/v2` (≥ 32 chars) |

## Status

Development proceeds in phases (repository → UI → database → SCIM → OIDC → authorization →
lifecycle → audit → testing → deployment). Setup, OIDC, SCIM, deployment and testing instructions
are completed in this README as each phase lands.
