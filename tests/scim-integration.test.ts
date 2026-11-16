import { beforeAll, describe, expect, it } from "vitest";
import * as UsersRoute from "@/app/scim/v2/Users/route";
import * as UserRoute from "@/app/scim/v2/Users/[id]/route";
import * as GroupsRoute from "@/app/scim/v2/Groups/route";
import * as GroupRoute from "@/app/scim/v2/Groups/[id]/route";
import * as SpcRoute from "@/app/scim/v2/ServiceProviderConfig/route";
import { call, PATCH_OP, query, resetDb } from "./helpers";
import { createSession } from "@/lib/auth/session";
import { resolvePrincipalFromToken } from "@/lib/authz/principal";

const newUser = (n: string, extra: Record<string, unknown> = {}) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
  userName: `${n}@demo.example`,
  externalId: `ext-${n}`,
  name: { givenName: n[0].toUpperCase() + n.slice(1), familyName: "Tester" },
  emails: [{ value: `${n}@demo.example`, type: "work", primary: true }],
  title: "Admission Officer",
  active: true,
  password: "should-never-be-stored",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { department: "Admissions" },
  ...extra,
});

describe("SCIM 2.0 service provider (integration)", () => {
  beforeAll(resetDb);

  let amaka: { id: string };
  let officers: { id: string };
  let managers: { id: string };

  it("rejects requests without or with a wrong bearer token", async () => {
    expect((await call(UsersRoute.GET, "GET", "/scim/v2/Users", undefined, null)).status).toBe(401);
    const r = await call(UsersRoute.GET, "GET", "/scim/v2/Users", undefined, "wrong-token");
    expect(r.status).toBe(401);
    expect(r.body.schemas).toContain("urn:ietf:params:scim:api:messages:2.0:Error");
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("serves the ServiceProviderConfig", async () => {
    const r = await call(SpcRoute.GET, "GET", "/scim/v2/ServiceProviderConfig");
    expect(r.status).toBe(200);
    expect(r.body.patch.supported).toBe(true);
    expect(r.headers.get("content-type")).toContain("application/scim+json");
  });

  it("provisions a user (POST /Users) → 201 with SCIM representation; password never stored", async () => {
    const r = await call(UsersRoute.POST, "POST", "/scim/v2/Users", newUser("amaka"));
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.userName).toBe("amaka@demo.example");
    expect(r.body.active).toBe(true);
    expect(r.body["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"].department).toBe("Admissions");
    expect(r.body.meta.location).toBe(`https://caps.test/scim/v2/Users/${r.body.id}`);
    expect(r.headers.get("location")).toBe(r.body.meta.location);
    expect(JSON.stringify(r.body)).not.toContain("should-never-be-stored");
    amaka = r.body;
    const [row] = await query<{ provisioning_source: string; scim_attributes: unknown }>("select provisioning_source, scim_attributes from users where id = $1", [amaka.id]);
    expect(row.provisioning_source).toBe("scim");
    expect(JSON.stringify(row.scim_attributes)).not.toContain("should-never-be-stored");
    const logs = await query("select * from scim_sync_logs where operation = 'create'");
    expect(JSON.stringify(logs[0].request_body)).toContain("[REDACTED]");
    const audit = await query("select action from audit_logs where target_id = $1", [amaka.id]);
    expect(audit.map((a) => a.action)).toContain("user.provisioned");
  });

  it("enforces uniqueness: duplicate userName (case-insensitive) or externalId → 409", async () => {
    const dup = await call(UsersRoute.POST, "POST", "/scim/v2/Users", newUser("amaka", { userName: "AMAKA@demo.example", externalId: "other" }));
    expect(dup.status).toBe(409);
    expect(dup.body.scimType).toBe("uniqueness");
    const dupExt = await call(UsersRoute.POST, "POST", "/scim/v2/Users", newUser("zed", { externalId: "ext-amaka" }));
    expect(dupExt.status).toBe(409);
    expect((await query("select count(*)::int as n from users"))[0].n).toBe(1);
  });

  it("validates input: missing userName → 400 invalidValue; bad JSON → 400 invalidSyntax", async () => {
    const r = await call(UsersRoute.POST, "POST", "/scim/v2/Users", { schemas: [] });
    expect(r.status).toBe(400);
    expect(r.body.scimType).toBe("invalidValue");
    const res = await UsersRoute.POST(new Request("https://caps.test/scim/v2/Users", { method: "POST", headers: { Authorization: `Bearer ${process.env.SCIM_TOKEN}` }, body: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("filters and paginates (GET /Users?filter=userName eq ...)", async () => {
    await call(UsersRoute.POST, "POST", "/scim/v2/Users", newUser("bola"));
    await call(UsersRoute.POST, "POST", "/scim/v2/Users", newUser("chidi"));
    const f = await call(UsersRoute.GET, "GET", `/scim/v2/Users?filter=${encodeURIComponent('userName eq "AMAKA@demo.example"')}`);
    expect(f.status).toBe(200);
    expect(f.body.totalResults).toBe(1);
    expect(f.body.Resources[0].id).toBe(amaka.id);
    const p = await call(UsersRoute.GET, "GET", "/scim/v2/Users?startIndex=2&count=1");
    expect(p.body).toMatchObject({ totalResults: 3, startIndex: 2, itemsPerPage: 1 });
    const ext = await call(UsersRoute.GET, "GET", `/scim/v2/Users?filter=${encodeURIComponent('externalId eq "ext-bola"')}`);
    expect(ext.body.totalResults).toBe(1);
    const bad = await call(UsersRoute.GET, "GET", `/scim/v2/Users?filter=${encodeURIComponent("nickName eq \"x\"")}`);
    expect(bad.status).toBe(400);
    expect(bad.body.scimType).toBe("invalidFilter");
    const none = await call(UsersRoute.GET, "GET", `/scim/v2/Users?filter=${encodeURIComponent('userName eq "nobody"')}`);
    expect(none.body).toMatchObject({ totalResults: 0, Resources: [] });
  });

  it("GET /Users/{id} returns the user; unknown id → 404", async () => {
    expect((await call(UserRoute.GET, "GET", `/scim/v2/Users/${amaka.id}`)).body.userName).toBe("amaka@demo.example");
    expect((await call(UserRoute.GET, "GET", "/scim/v2/Users/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await call(UserRoute.GET, "GET", "/scim/v2/Users/not-a-uuid")).status).toBe(404);
  });

  it("updates without creating duplicates (PUT and PATCH)", async () => {
    const put = await call(UserRoute.PUT, "PUT", `/scim/v2/Users/${amaka.id}`, newUser("amaka", { title: "Senior Admission Officer" }));
    expect(put.status).toBe(200);
    expect(put.body.title).toBe("Senior Admission Officer");
    const patch = await call(UserRoute.PATCH, "PATCH", `/scim/v2/Users/${amaka.id}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "Replace", value: { "name.familyName": "Okafor", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department": "Admissions Policy" } }],
    });
    expect(patch.status).toBe(200);
    expect(patch.body.name.familyName).toBe("Okafor");
    expect(patch.body["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"].department).toBe("Admissions Policy");
    expect((await query("select count(*)::int as n from users where lower(user_name) = 'amaka@demo.example'"))[0].n).toBe(1);
    const updates = await query("select details from audit_logs where action = 'user.updated' and target_id = $1", [amaka.id]);
    expect(updates.length).toBe(2);
  });

  it("imports pre-existing CAPS groups: GET /Groups lists them (excludedAttributes=members supported)", async () => {
    await query("insert into groups (display_name, provisioning_source) values ('CAPS Admission Officers', 'caps_native')");
    const r = await call(GroupsRoute.GET, "GET", "/scim/v2/Groups?excludedAttributes=members");
    expect(r.status).toBe(200);
    expect(r.body.totalResults).toBe(1);
    expect(r.body.Resources[0].displayName).toBe("CAPS Admission Officers");
    expect(r.body.Resources[0].members).toBeUndefined();
    officers = r.body.Resources[0];
  });

  it("creates a new group from Fixiam (POST /Groups); duplicate name → 409", async () => {
    const r = await call(GroupsRoute.POST, "POST", "/scim/v2/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "CAPS Admission Managers", externalId: "fx-grp-mgr" });
    expect(r.status).toBe(201);
    managers = r.body;
    const dup = await call(GroupsRoute.POST, "POST", "/scim/v2/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "caps admission managers" });
    expect(dup.status).toBe(409);
  });

  it("adds a provisioned user to a mapped group → role granted (Admission Officer)", async () => {
    const r = await call(GroupRoute.PATCH, "PATCH", `/scim/v2/Groups/${officers.id}`, { schemas: [PATCH_OP], Operations: [{ op: "add", path: "members", value: [{ value: amaka.id }] }] });
    expect(r.status).toBe(200);
    expect(r.body.members.map((m: { value: string }) => m.value)).toEqual([amaka.id]);
    const roles = await query("select role_key from user_entitlements where user_id = $1 and revoked_at is null", [amaka.id]);
    expect(roles.map((x) => x.role_key)).toEqual(["admission_officer"]);
    // idempotent re-add
    await call(GroupRoute.PATCH, "PATCH", `/scim/v2/Groups/${officers.id}`, { schemas: [PATCH_OP], Operations: [{ op: "add", path: "members", value: [{ value: amaka.id }] }] });
    expect((await query("select count(*)::int as n from group_memberships"))[0].n).toBe(1);
    // the user resource reflects the group (readOnly attribute)
    const u = await call(UserRoute.GET, "GET", `/scim/v2/Users/${amaka.id}`);
    expect(u.body.groups[0].display).toBe("CAPS Admission Officers");
    // members.value filter
    const f = await call(GroupsRoute.GET, "GET", `/scim/v2/Groups?filter=${encodeURIComponent(`members.value eq "${amaka.id}"`)}`);
    expect(f.body.totalResults).toBe(1);
  });

  it("skips unknown member references instead of inventing users", async () => {
    const r = await call(GroupRoute.PATCH, "PATCH", `/scim/v2/Groups/${managers.id}`, { schemas: [PATCH_OP], Operations: [{ op: "add", path: "members", value: [{ value: "11111111-1111-1111-1111-111111111111" }] }] });
    expect(r.status).toBe(200);
    expect(r.body.members).toEqual([]);
    expect((await query("select count(*)::int as n from audit_logs where action = 'group.member_reference_skipped'"))[0].n).toBe(1);
  });

  it("changes role centrally: move user from Officers to Managers → permissions follow", async () => {
    await call(GroupRoute.PATCH, "PATCH", `/scim/v2/Groups/${managers.id}`, { schemas: [PATCH_OP], Operations: [{ op: "add", path: "members", value: [{ value: amaka.id }] }] });
    await call(GroupRoute.PATCH, "PATCH", `/scim/v2/Groups/${officers.id}`, { schemas: [PATCH_OP], Operations: [{ op: "remove", path: `members[value eq "${amaka.id}"]` }] });
    const roles = await query("select role_key from user_entitlements where user_id = $1 and revoked_at is null", [amaka.id]);
    expect(roles.map((x) => x.role_key)).toEqual(["admission_manager"]);
    const history = await query("select action from audit_logs where target_id = $1 order by id", [amaka.id]);
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["group.member_added", "role.granted", "group.member_removed", "role.revoked"]));
    // membership removal does NOT deactivate the account
    const [u] = await query("select active from users where id = $1", [amaka.id]);
    expect(u.active).toBe(true);
  });

  it("session revalidation: permissions change on the next request; deactivation revokes the session", async () => {
    const { token } = await createSession({ userId: amaka.id });
    let p = await resolvePrincipalFromToken(token);
    expect(p.ok && [...p.principal.permissions]).toContain("admissions.approve");

    // Remove from Managers group → next request has no decision permission, but the session stays valid.
    await call(GroupRoute.PATCH, "PATCH", `/scim/v2/Groups/${managers.id}`, { schemas: [PATCH_OP], Operations: [{ op: "remove", path: "members", value: [{ value: amaka.id }] }] });
    p = await resolvePrincipalFromToken(token);
    expect(p.ok).toBe(true);
    expect(p.ok && p.principal.permissions.size).toBe(0);

    // Deactivate (Fixiam withdraws the application assignment) → session revoked immediately.
    const d = await call(UserRoute.PATCH, "PATCH", `/scim/v2/Users/${amaka.id}`, { schemas: [PATCH_OP], Operations: [{ op: "replace", path: "active", value: "False" }] });
    expect(d.status).toBe(200);
    expect(d.body.active).toBe(false);
    p = await resolvePrincipalFromToken(token);
    expect(p).toEqual({ ok: false, reason: "session_revoked" });
    const actions = (await query("select action from audit_logs where target_id = $1", [amaka.id])).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.deactivated", "session.revoked"]));
  });

  it("reactivation restores the account (new login required)", async () => {
    const r = await call(UserRoute.PATCH, "PATCH", `/scim/v2/Users/${amaka.id}`, { schemas: [PATCH_OP], Operations: [{ op: "replace", value: { active: true } }] });
    expect(r.body.active).toBe(true);
    const { token } = await createSession({ userId: amaka.id });
    expect((await resolvePrincipalFromToken(token)).ok).toBe(true);
  });

  it("PUT /Groups replaces membership; DELETE /Groups removes roles", async () => {
    const put = await call(GroupRoute.PUT, "PUT", `/scim/v2/Groups/${officers.id}`, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "CAPS Admission Officers", members: [{ value: amaka.id }] });
    expect(put.status).toBe(200);
    expect((await query("select role_key from user_entitlements where user_id = $1 and revoked_at is null", [amaka.id])).map((x) => x.role_key)).toEqual(["admission_officer"]);
    const del = await call(GroupRoute.DELETE, "DELETE", `/scim/v2/Groups/${officers.id}`);
    expect(del.status).toBe(204);
    expect((await query("select count(*)::int as n from user_entitlements where user_id = $1 and revoked_at is null", [amaka.id]))[0].n).toBe(0);
    expect((await call(GroupRoute.GET, "GET", `/scim/v2/Groups/${officers.id}`)).status).toBe(404);
  });

  it("deprovisions a user (DELETE /Users) → soft delete, 404 afterwards, sessions revoked, can be re-provisioned", async () => {
    await call(GroupRoute.PATCH, "PATCH", `/scim/v2/Groups/${managers.id}`, { schemas: [PATCH_OP], Operations: [{ op: "add", path: "members", value: [{ value: amaka.id }] }] });
    const { token } = await createSession({ userId: amaka.id });
    const r = await call(UserRoute.DELETE, "DELETE", `/scim/v2/Users/${amaka.id}`);
    expect(r.status).toBe(204);
    expect((await call(UserRoute.GET, "GET", `/scim/v2/Users/${amaka.id}`)).status).toBe(404);
    expect((await call(UserRoute.DELETE, "DELETE", `/scim/v2/Users/${amaka.id}`)).status).toBe(404);
    expect((await resolvePrincipalFromToken(token)).ok).toBe(false);
    expect((await query("select count(*)::int as n from group_memberships where user_id = $1", [amaka.id]))[0].n).toBe(0);
    const again = await call(UsersRoute.POST, "POST", "/scim/v2/Users", newUser("amaka"));
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(amaka.id);
  });

  it("never exposes sample records over SCIM", async () => {
    await query("insert into users (user_name, provisioning_source, sample_role_label) values ('sample.person@sample.caps-demo.ng', 'sample', 'Admission Officer')");
    const r = await call(UsersRoute.GET, "GET", `/scim/v2/Users?filter=${encodeURIComponent('userName co "sample.caps-demo.ng"')}`);
    expect(r.body.totalResults).toBe(0);
  });

  it("logs every SCIM request, including rejected ones", async () => {
    const [{ n }] = await query("select count(*)::int as n from scim_sync_logs where status_code = 401");
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
