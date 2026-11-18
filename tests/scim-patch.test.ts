import { describe, expect, it } from "vitest";
import { applyPatch, PATCH_SCHEMA } from "@/lib/scim/patch";
import { GROUP_MULTI_VALUED, SCHEMA_ENTERPRISE_USER, SCHEMA_GROUP, SCHEMA_USER, USER_MULTI_VALUED } from "@/lib/scim/constants";

const U = { multiValued: USER_MULTI_VALUED, coreSchemas: [SCHEMA_USER] };
const G = { multiValued: GROUP_MULTI_VALUED, coreSchemas: [SCHEMA_GROUP] };
const ops = (...Operations: unknown[]) => ({ schemas: [PATCH_SCHEMA], Operations });

const user = () => ({
  id: "u1", userName: "amina", active: true, name: { givenName: "Amina", familyName: "Yusuf" },
  emails: [{ value: "amina@x.ng", type: "work", primary: true }],
});

describe("SCIM PATCH engine", () => {
  it("replaces a simple attribute (Azure-style capitalised op and string boolean)", () => {
    expect(applyPatch(user(), ops({ op: "Replace", path: "active", value: "False" }), U).active).toBe("False");
  });
  it("replaces without a path using dotted and URN keys", () => {
    const r = applyPatch(user(), ops({ op: "replace", value: { "name.givenName": "Aminat", [`${SCHEMA_ENTERPRISE_USER}:department`]: "Admissions", title: "Officer" } }), U);
    expect(r.name).toEqual({ givenName: "Aminat", familyName: "Yusuf" });
    expect((r[SCHEMA_ENTERPRISE_USER] as Record<string, unknown>).department).toBe("Admissions");
    expect(r.title).toBe("Officer");
  });
  it("merges sub-attributes when replacing a complex attribute", () => {
    const r = applyPatch(user(), ops({ op: "replace", path: "name", value: { familyName: "Bello" } }), U);
    expect(r.name).toEqual({ givenName: "Amina", familyName: "Bello" });
  });
  it("updates a filtered multi-valued element", () => {
    const r = applyPatch(user(), ops({ op: "replace", path: 'emails[type eq "work"].value', value: "new@x.ng" }), U);
    expect((r.emails as { value: string }[])[0].value).toBe("new@x.ng");
  });
  it("sets an extension attribute via URN path", () => {
    const r = applyPatch(user(), ops({ op: "add", path: `${SCHEMA_ENTERPRISE_USER}:department`, value: "ICT" }), U);
    expect(r[SCHEMA_ENTERPRISE_USER]).toEqual({ department: "ICT" });
  });
  it("adds group members idempotently", () => {
    const g = { id: "g1", displayName: "Officers", members: [{ value: "a" }] };
    const r = applyPatch(g, ops({ op: "add", path: "members", value: [{ value: "a" }, { value: "b" }] }), G);
    expect(r.members).toEqual([{ value: "a" }, { value: "b" }]);
  });
  it("removes a member by filter and by value array (Azure style)", () => {
    const g = { id: "g1", displayName: "Officers", members: [{ value: "a" }, { value: "b" }, { value: "c" }] };
    const r1 = applyPatch(g, ops({ op: "remove", path: 'members[value eq "b"]' }), G);
    expect(r1.members).toEqual([{ value: "a" }, { value: "c" }]);
    const r2 = applyPatch(g, ops({ op: "remove", path: "members", value: [{ value: "a" }, { value: "c" }] }), G);
    expect(r2.members).toEqual([{ value: "b" }]);
  });
  it("removes all members when remove has no value", () => {
    const g = { id: "g1", displayName: "Officers", members: [{ value: "a" }] };
    expect(applyPatch(g, ops({ op: "remove", path: "members" }), G).members).toBeUndefined();
  });
  it("replaces the member list", () => {
    const g = { id: "g1", displayName: "Officers", members: [{ value: "a" }] };
    expect(applyPatch(g, ops({ op: "replace", path: "members", value: [{ value: "z" }] }), G).members).toEqual([{ value: "z" }]);
  });
  it("rejects bad requests", () => {
    expect(() => applyPatch(user(), { Operations: [] }, U)).toThrow(/schema/);
    expect(() => applyPatch(user(), ops({ op: "move", path: "x" }), U)).toThrow(/Unsupported/);
    expect(() => applyPatch(user(), ops({ op: "remove" }), U)).toThrow(/requires a path/);
    expect(() => applyPatch(user(), ops({ op: "replace", path: 'emails[type eq "home"].value', value: "x" }), U)).toThrow(/No values matched/);
  });
  it("does not mutate the input", () => {
    const u = user();
    applyPatch(u, ops({ op: "replace", path: "userName", value: "x" }), U);
    expect(u.userName).toBe("amina");
  });
});
