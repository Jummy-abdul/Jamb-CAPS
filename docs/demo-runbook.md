# CAPS × Fixiam demonstration runbook

Works with **any** user created in Fixiam; nothing in CAPS is specific to a particular person.
The names below are examples only.

## Before the demonstration

1. CAPS deployed and `GET https://<caps-host>/api/health` shows all integrations `true`.
2. In Fixiam: OIDC client and SCIM connector configured as in [fixiam-integration.md](fixiam-integration.md).
3. In Fixiam **Manage Groups**: import the CAPS groups (`CAPS Admission Officers`, `CAPS Admission
   Managers`, `CAPS System Administrators`) or create groups with those names.
4. Create a **presenter administrator** in Fixiam, assign the CAPS application and add them to
   `CAPS System Administrators`. Sign in once in a separate browser profile; keep it open on the
   User Directory.
5. Optional: open **SCIM Sync Logs** in a second tab to show traffic live.

## Scenario 1: Automated user provisioning

1. In Fixiam create the user (e.g. *Amina Yusuf*), assign the CAPS application.
2. Fixiam sends `POST /scim/v2/Users`.
3. In CAPS (admin browser) refresh **User Directory**: the user appears with **Fixiam · SCIM**,
   status *Active*, *Last synchronised* a few seconds ago.
4. Show **SCIM Sync Logs** (`POST /scim/v2/Users → 201`) and the user's detail page.
5. In Fixiam add the user to `CAPS Admission Officers` → `PATCH /Groups` → the directory shows the
   *Admission Officer* role.

## Scenario 2: Single Sign-On

1. In a second browser (or private window) open CAPS → **Login with Fixiam**.
2. Authenticate at Fixiam → returned to the CAPS **Dashboard**. No CAPS password exists.
3. Audit: `identity.linked` (first sign-in) and `authentication.login_succeeded`.

## Scenario 3: Centralised role management

1. As the officer: **Application Review** → open an application → *Start review*, choose a
   recommendation, add notes → *Review recorded*.
2. Try **Approve admission** → *Access denied* (the API refuses with 403; `access.denied` audited).
   The **Admission Decisions** menu item is not shown and the URL is refused.
3. In Fixiam move the user from `CAPS Admission Officers` to `CAPS Admission Managers`.
4. Back in CAPS (same session, just refresh): the role badge shows *Admission Manager*;
   **Approve admission** now succeeds.

## Scenario 4: Access revocation

Pick one:

* **Withdraw the CAPS application assignment / let the entitlement expire** in Fixiam → Fixiam
  sends `active=false` or `DELETE`. On the next click the user is returned to the login page:
  *"Your CAPS access has been deactivated in Fixiam"*. Signing in again is refused.
* **Remove the user from their group** → the user stays signed in but loses that group's
  permissions (dashboard shows *no CAPS role assigned*). The account is not deactivated.

Show the user's detail page: entitlement *Revoked*, session *Revoked · User Deactivated*.

## Scenario 5: Audit trail

**Audit Logs** → search the user's name. Shows in order: `user.provisioned`, `group.member_added`,
`role.granted`, `identity.linked`, `authentication.login_succeeded`, `application.reviewed`,
`access.denied`, `role.revoked`/`role.granted` (role change), `admission.approved`,
`user.deactivated`, `session.revoked`, `authentication.login_denied`.
Each entry shows timestamp, actor (Fixiam SCIM, Fixiam OIDC, or the user), action, affected user
and details. The audit table is append-only at the database level.

## Resetting between rehearsals

* Deactivate/delete demo users in Fixiam (CAPS keeps their history).
* Restore fresh applicant data: `npm run db:seed -- --reset`. This recreates all fictional
  applicants/applications (including reviews and decisions made during rehearsal) and the sample
  staff records. Fixiam-provisioned users, groups, memberships and the audit history are untouched.
