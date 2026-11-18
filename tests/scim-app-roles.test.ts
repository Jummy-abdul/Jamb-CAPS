import { beforeEach, describe, expect, it } from "vitest";
import * as UsersRoute from "@/app/scim/v2/Users/route";
import * as UserRoute from "@/app/scim/v2/Users/[id]/route";
import { call, PATCH_OP, query, resetDb } from "./helpers";

/**
 * Fixiam application-role provisioning → CAPS entitlements.
 *
 * Fixiam assigns application roles and provisions them over SCIM via the standard User `roles`
 * attribute (type "appRole") and/or the Fixiam authorization extension `appRoles`. CAPS maps the
 * external role value to an internal role (role_mappings source_type='application_role') and
 * derives permissions. These tests exercise the full contract end-to-end through the SCIM API.
 */

const FIXIAM_AUTHZ = "urn:fixiam:params:scim:schemas:extension:authorization:2.0:User";

const base = (login: string, over: Record<string, unknown> = {}) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: `${login}@demo.example`,
  externalId: `ext-${login}`,
  name: { givenName: login, familyName: "Tester" },
  emails: [{ value: `${login}@demo.example`, type: "work", primary: true }],
  active: true,
  ...over,
});

const stdRole = (value: string) => ({ roles: [{ type: "appRole", value, display: value, primary: true }] });
const extRole = (...values: string[]) => ({ [FIXIAM_AUTHZ]: { appRoles: values } });

const create = (body: unknown) => call(UsersRoute.POST, "POST", "/scim/v2/Users", body);
const patch = (id: string, Operations: unknown[]) => call(UserRoute.PATCH, "PATCH", `/scim/v2/Users/${id}`, { schemas: [PATCH_OP], Operations });
const put = (id: string, body: unknown) => call(UserRoute.PUT, "PUT", `/scim/v2/Users/${id}`, body);
const del = (id: string) => call(UserRoute.DELETE, "DELETE", `/scim/v2/Users/${id}`);

async function activeEntitlements(userId: string) {
  return query<{ role_key: string; source_kind: string; source_ref: string | null }>(
    "select role_key, source_kind, source_ref from user_entitlements where user_id = $1 and revoked_at is null order by role_key, source_kind",
    [userId],
  );
}
async function perms(userId: string) {
  const rows = await query<{ permission_key: string }>(
    `select distinct rp.permission_key from user_entitlements ue
       join role_permissions rp on rp.role_key = ue.role_key
      where ue.user_id = $1 and ue.revoked_at is null order by 1`,
    [userId],
  );
  return rows.map((r) => r.permission_key);
}

describe("Fixiam application-role provisioning via SCIM", () => {
  beforeEach(async () => {
    await resetDb();
    // CAPS-owned mapping config: external Fixiam role value → internal role. Seeded as 'system'
    // so it survives resetDb (which only clears non-system mappings).
    await query(
      `insert into role_mappings (source_type, source_value, role_key, description, created_by) values
         ('application_role', 'admission_manager', 'admission_manager', 'test', 'system'),
         ('application_role', 'admission_officer',  'admission_officer',  'test', 'system')
       on conflict do nothing`,
    );
  });

  it("grants a role from the standard SCIM roles attribute (type appRole)", async () => {
    const u = await create(base("ngozi", stdRole("admission_manager")));
    expect(u.status).toBe(201);
    expect(await activeEntitlements(u.body.id)).toEqual([
      { role_key: "admission_manager", source_kind: "application_role", source_ref: "admission_manager" },
    ]);
    expect(await perms(u.body.id)).toContain("admissions.approve");
    // Persisted as first-class state, union-source recorded.
    const [row] = await query<{ provisioned_app_roles: { value: string; source: string }[] }>("select provisioned_app_roles from users where id = $1", [u.body.id]);
    expect(row.provisioned_app_roles).toEqual([{ value: "admission_manager", display: "admission_manager", source: "roles" }]);
    // Audited as a provisioned application role.
    const [a] = await query<{ details: Record<string, unknown> }>("select details from audit_logs where action = 'role.granted' and target_id = $1", [u.body.id]);
    expect(a.details).toMatchObject({ role: "admission_manager", source: "application_role", via: "admission_manager" });
  });

  it("grants a role from the Fixiam authorization extension appRoles", async () => {
    const u = await create(base("tunde", extRole("admission_officer")));
    expect(await activeEntitlements(u.body.id)).toEqual([
      { role_key: "admission_officer", source_kind: "application_role", source_ref: "admission_officer" },
    ]);
    const [row] = await query<{ provisioned_app_roles: { source: string }[] }>("select provisioned_app_roles from users where id = $1", [u.body.id]);
    expect(row.provisioned_app_roles[0].source).toBe("ext");
  });

  it("de-duplicates when both representations carry the same role (precedence: union, source 'both')", async () => {
    const u = await create(base("hauwa", { ...stdRole("admission_manager"), ...extRole("admission_manager") }));
    expect(await activeEntitlements(u.body.id)).toEqual([
      { role_key: "admission_manager", source_kind: "application_role", source_ref: "admission_manager" },
    ]);
    const [row] = await query<{ provisioned_app_roles: { value: string; source: string }[] }>("select provisioned_app_roles from users where id = $1", [u.body.id]);
    expect(row.provisioned_app_roles).toEqual([{ value: "admission_manager", display: "admission_manager", source: "both" }]);
  });

  it("PATCH add → grants; PATCH replace → swaps; PATCH remove → revokes", async () => {
    const u = await create(base("kemi")); // no roles
    expect(await activeEntitlements(u.body.id)).toEqual([]);

    // add
    await patch(u.body.id, [{ op: "add", path: "roles", value: [{ type: "appRole", value: "admission_officer" }] }]);
    expect((await activeEntitlements(u.body.id)).map((e) => e.role_key)).toEqual(["admission_officer"]);

    // replace (officer → manager)
    await patch(u.body.id, [{ op: "replace", path: "roles", value: [{ type: "appRole", value: "admission_manager" }] }]);
    expect((await activeEntitlements(u.body.id)).map((e) => e.role_key)).toEqual(["admission_manager"]);
    // officer entitlement is now revoked (history preserved)
    expect((await query("select 1 from user_entitlements where user_id=$1 and role_key='admission_officer' and revoked_at is not null", [u.body.id]))).toHaveLength(1);

    // remove
    await patch(u.body.id, [{ op: "remove", path: `roles[value eq "admission_manager"]` }]);
    expect(await activeEntitlements(u.body.id)).toEqual([]);
    expect(await perms(u.body.id)).toEqual([]);
  });

  it("PUT replace without roles removes a previously assigned role", async () => {
    const u = await create(base("sade", stdRole("admission_manager")));
    expect((await activeEntitlements(u.body.id))).toHaveLength(1);
    const r = await put(u.body.id, base("sade")); // full replace, no roles
    expect(r.status).toBe(200);
    expect(await activeEntitlements(u.body.id)).toEqual([]);
  });

  it("unknown / unmapped application role grants no permissions", async () => {
    const u = await create(base("obi", stdRole("registrar"))); // no mapping for 'registrar'
    expect(await activeEntitlements(u.body.id)).toEqual([]);
    expect(await perms(u.body.id)).toEqual([]);
    // but the raw assignment is still persisted (for visibility), just not authorized
    const [row] = await query<{ provisioned_app_roles: { value: string }[] }>("select provisioned_app_roles from users where id = $1", [u.body.id]);
    expect(row.provisioned_app_roles[0].value).toBe("registrar");
  });

  it("deactivation revokes all access; reactivation restores it", async () => {
    const u = await create(base("amara", stdRole("admission_manager")));
    expect((await activeEntitlements(u.body.id))).toHaveLength(1);

    await patch(u.body.id, [{ op: "replace", value: { active: false } }]);
    expect(await activeEntitlements(u.body.id)).toEqual([]);

    await patch(u.body.id, [{ op: "replace", value: { active: true } }]);
    expect((await activeEntitlements(u.body.id)).map((e) => e.role_key)).toEqual(["admission_manager"]);
  });

  it("deprovision (DELETE) revokes all application-role entitlements", async () => {
    const u = await create(base("blessing", stdRole("admission_manager")));
    expect((await activeEntitlements(u.body.id))).toHaveLength(1);
    expect((await del(u.body.id)).status).toBe(204);
    expect(await activeEntitlements(u.body.id)).toEqual([]);
  });

  it("case-insensitive mapping match; does not consume non-appRole role entries", async () => {
    // External value differs in case; role entry of another type must be ignored.
    const u = await create(
      base("idris", { roles: [
        { type: "appRole", value: "Admission_Manager" },
        { type: "directory", value: "should-be-ignored" },
      ] }),
    );
    expect((await activeEntitlements(u.body.id)).map((e) => e.role_key)).toEqual(["admission_manager"]);
  });

  it("does not use OIDC token role/groups claims — only SCIM-provisioned state (no roles → no access)", async () => {
    const u = await create(base("zainab")); // active, provisioned, but no roles and no groups
    expect(await activeEntitlements(u.body.id)).toEqual([]);
    expect(await perms(u.body.id)).toEqual([]);
  });

  it("backward compatibility: group-based mapping still grants, independently of app roles", async () => {
    // Native group + default group mapping already exist in reference data.
    const g = await call(
      (await import("@/app/scim/v2/Groups/route")).POST,
      "POST",
      "/scim/v2/Groups",
      { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "CAPS Admission Officers", members: [] },
    );
    const u = await create(base("femi")); // no app roles
    // add the user to the group via Group PATCH
    await call(
      (await import("@/app/scim/v2/Groups/[id]/route")).PATCH,
      "PATCH",
      `/scim/v2/Groups/${g.body.id}`,
      { schemas: [PATCH_OP], Operations: [{ op: "add", path: "members", value: [{ value: u.body.id }] }] },
    );
    const ent = await activeEntitlements(u.body.id);
    expect(ent).toEqual([{ role_key: "admission_officer", source_kind: "group", source_ref: g.body.id }]);
  });

  it("a role held via BOTH a group and an app role survives removal of one source", async () => {
    const g = await call(
      (await import("@/app/scim/v2/Groups/route")).POST,
      "POST",
      "/scim/v2/Groups",
      { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "CAPS Admission Officers", members: [] },
    );
    const u = await create(base("deji", stdRole("admission_officer")));
    await call(
      (await import("@/app/scim/v2/Groups/[id]/route")).PATCH,
      "PATCH",
      `/scim/v2/Groups/${g.body.id}`,
      { schemas: [PATCH_OP], Operations: [{ op: "add", path: "members", value: [{ value: u.body.id }] }] },
    );
    // Two sources for the same role.
    expect((await activeEntitlements(u.body.id)).map((e) => `${e.role_key}:${e.source_kind}`).sort()).toEqual([
      "admission_officer:application_role",
      "admission_officer:group",
    ]);
    // Remove the app role → still held via the group.
    await patch(u.body.id, [{ op: "remove", path: `roles[value eq "admission_officer"]` }]);
    expect((await activeEntitlements(u.body.id)).map((e) => `${e.role_key}:${e.source_kind}`)).toEqual(["admission_officer:group"]);
    expect(await perms(u.body.id)).toContain("applications.review");
  });
});
