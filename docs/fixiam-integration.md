# Fixiam ↔ CAPS integration guide

This guide describes exactly what CAPS implements and what must be configured in Fixiam.
CAPS has been tested end-to-end against a standards-compliant OpenID Provider and with
SCIM 2.0 requests that follow RFC 7643/7644. **It has not yet been tested against Fixiam
itself** — items marked _(confirm in Fixiam)_ depend on Fixiam's behaviour and must be verified
during integration.

Replace `https://<caps-host>` below with the production URL (e.g. `https://jamb-caps-demo.vercel.app`).

---

## 1. Single Sign-On (OpenID Connect)

| Setting in Fixiam (OIDC client) | Value |
|---|---|
| Application type | Confidential web application |
| Grant type | Authorization Code (PKCE S256 is always sent by CAPS) |
| Redirect / callback URI | `https://<caps-host>/api/auth/callback` |
| Post-logout redirect URI | `https://<caps-host>/login` |
| Scopes | `openid profile email` (configurable via `FIXIAM_SCOPES`) |
| Client authentication | `client_secret_basic` (default) or `client_secret_post` → set `FIXIAM_TOKEN_AUTH_METHOD` |

CAPS environment variables: `FIXIAM_ISSUER_URL`, `FIXIAM_CLIENT_ID`, `FIXIAM_CLIENT_SECRET`,
`FIXIAM_REDIRECT_URI`, `FIXIAM_POST_LOGOUT_REDIRECT_URI`.

**What CAPS does**

1. Reads `<FIXIAM_ISSUER_URL>/.well-known/openid-configuration` (no endpoints are hard-coded).
2. Redirects to the advertised `authorization_endpoint` with `state`, `nonce`, `code_challenge` (S256).
   State, nonce and the PKCE verifier are stored server-side and bound to the browser with a
   single-use HttpOnly cookie.
3. Exchanges the code at `token_endpoint` server-to-server.
4. Validates the ID token: JWS signature against `jwks_uri`, `iss`, `aud`, `exp`/`iat`, `nonce`.
5. Maps the identity to the account Fixiam provisioned over SCIM, in this order:
   `sub` already linked → SCIM `externalId == sub` → SCIM `userName == preferred_username` or `email`
   → primary email. On first sign-in the `sub` is stored and used from then on.
6. Refuses sign-in if the user was never provisioned, is deactivated or was deprovisioned.
7. Sign-out revokes the CAPS session and redirects to `end_session_endpoint` (if advertised).

**Claims used:** `sub` (required), `email`, `name`, `given_name`, `family_name`,
`preferred_username`. `groups` and `role` are recorded in the audit log when present but are
**not** used for authorization: roles come from SCIM group membership, so revocation does not
depend on the user signing in again.

_(confirm in Fixiam)_: discovery URL/issuer, client auth method, whether `email`/`preferred_username`
are released, whether `end_session_endpoint` is advertised. Use **Integration Settings → Verify
Fixiam discovery document** in CAPS to see what Fixiam advertises.

> **Recommendation:** configure Fixiam to send the user's OIDC `sub` as the SCIM `externalId`,
> or make the SCIM `userName` equal to the user's email / preferred_username. Either guarantees
> a deterministic link between the provisioned account and the SSO identity.

---

## 2. Outbound user provisioning (SCIM 2.0)

| Setting in Fixiam (SCIM connector) | Value |
|---|---|
| SCIM base / tenant URL | `https://<caps-host>/scim/v2` |
| Authentication | HTTP header `Authorization: Bearer <SCIM_TOKEN>` |
| Content type | `application/scim+json` (CAPS also accepts `application/json`) |

Generate the token with `openssl rand -hex 32`, store it in Vercel as `SCIM_TOKEN`, and paste the
same value into Fixiam. The Integration Settings page shows a SHA-256 fingerprint so both sides
can be compared without revealing it.

**Endpoints**

| Operation | Endpoint | Result in CAPS |
|---|---|---|
| Create user | `POST /Users` | Account created (`provisioning_source = scim`), appears in User Directory, `user.provisioned` audited. 409 `uniqueness` if `userName` (case-insensitive) or `externalId` exists. |
| Look up | `GET /Users?filter=userName eq "…"` / `externalId eq "…"` | Supports `eq ne co sw ew gt ge lt le pr and or not` and `startIndex`/`count`. |
| Read | `GET /Users/{id}` | |
| Update | `PUT /Users/{id}` or `PATCH /Users/{id}` | Updated in place (never duplicated). `user.updated` audited with changed fields. |
| Deactivate | `active=false` via PUT/PATCH | Access suspended, **all sessions revoked immediately**, `user.deactivated` + `session.revoked` audited. |
| Reactivate | `active=true` | Account re-enabled (user must sign in again). |
| Deprovision | `DELETE /Users/{id}` | Soft-deleted (history kept), removed from all groups, roles revoked, sessions revoked; subsequent GET → 404. Re-provisioning creates a new account. |

Supported attributes: `userName`, `externalId`, `name.givenName`, `name.familyName`,
`name.formatted`, `displayName`, `emails`, `active`, `title`, and `department`
(enterprise extension `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`; a top-level
`department` is also accepted). Other attributes (e.g. `phoneNumbers`, `roles`, `entitlements`)
are stored and returned unchanged. `password` is ignored and never stored or logged.

Discovery endpoints: `/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`.

---

## 3. Manage Groups (SCIM 2.0)

| Fixiam workflow | CAPS endpoint | Notes |
|---|---|---|
| Retrieve existing CAPS groups for import | `GET /Groups` (optionally `?excludedAttributes=members`) | Pre-existing CAPS groups are seeded (`provisioning_source = caps_native`). |
| Create group in Fixiam → provision to CAPS | `POST /Groups` | 409 if the display name (case-insensitive) or externalId exists. |
| Assign / remove users | `PATCH /Groups/{id}` (`add`/`remove` `members`) or `PUT /Groups/{id}` | Only users already provisioned to CAPS can be members; unknown references are skipped and audited (`group.member_reference_skipped`). |
| Rename group | `PATCH`/`PUT` `displayName` | Role mappings re-evaluated for all members. |
| Delete group | `DELETE /Groups/{id}` | Memberships removed and roles recalculated. |

PATCH forms accepted: `{"op":"add","path":"members","value":[{"value":"<userId>"}]}`,
`{"op":"remove","path":"members[value eq \"<userId>\"]"}`,
`{"op":"remove","path":"members","value":[{"value":"<userId>"}]}`,
`{"op":"replace","path":"members","value":[…]}`, and `{"op":"replace","value":{"displayName":"…"}}`.
Op names are case-insensitive.

**User provisioning and group provisioning are independent.** Removing a user from a group
removes only the permissions that group grants; it does **not** deactivate the account.
Withdrawing the CAPS application assignment (deactivate or DELETE user) is a separate lifecycle
event that removes all access.

---

## 4. Role mapping (groups → CAPS roles)

SCIM 2.0 has no standard attribute for application-specific roles, so CAPS maps groups to roles
through a configurable table (**Role & Permission Mapping** page). Default mappings, matched by
group display name (case-insensitive):

| Fixiam group | CAPS role | Key permissions |
|---|---|---|
| CAPS Admission Officers | Admission Officer | view applicants, review applications, add notes |
| CAPS Admission Managers | Admission Manager | + approve / reject / hold admissions, reports |
| CAPS System Administrators | System Administrator | user directory, groups, mappings, SCIM logs, audit, settings |

Administrators can add mappings (by display name or by group `externalId`) and enable/disable
them. Every change re-evaluates all affected users immediately and is audited. An administrator
cannot create or change a mapping that would alter their own access.

---

## 5. Time-based access and revocation

CAPS does **not** run local countdowns to simulate expiry. It reacts to the lifecycle events that
Fixiam sends:

| Event in Fixiam | Expected SCIM call | Effect in CAPS |
|---|---|---|
| Time-bound entitlement expires / app assignment withdrawn | `PATCH active=false` or `DELETE /Users/{id}` _(confirm in Fixiam)_ | All access removed, sessions revoked at once |
| Group-based role expires / removed | `PATCH /Groups/{id}` remove member _(confirm in Fixiam)_ | That role's permissions removed on the next request; session stays valid |
| User disabled in Fixiam | `PATCH active=false` | As above |

Every page load and API call re-validates the session, account status and effective permissions
against the database, so changes take effect on the user's very next request.

**Dependency to confirm with Fixiam:** whether Fixiam supports time-bound assignments for
application or group membership and, when they expire, which SCIM operation it sends (and how
soon after expiry). If Fixiam does not push an update at expiry, the limitation is on the
provisioning side; CAPS cannot detect expiry it is not told about. CAPS enforces any change it
receives immediately.

---

## 6. Troubleshooting

* **SCIM Sync Logs** shows every request (including 401/4xx) with a sanitised body and the
  CAPS response summary.
* **Audit Logs** shows sign-in failures with the failing stage (`authorization_request`,
  `state_validation`, `token_validation`) and reason (`not_provisioned`, `account_inactive`, …).
* `GET /api/health` reports which integrations are configured (no secret values).
