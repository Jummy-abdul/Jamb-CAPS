import { beforeEach, describe, expect, it } from "vitest";
import * as UsersRoute from "@/app/scim/v2/Users/route";
import { call, query, resetDb } from "./helpers";
import { linkIdentity } from "@/lib/auth/link";
import type { FixiamIdentity } from "@/lib/auth/oidc";

const ident = (over: Partial<FixiamIdentity>): FixiamIdentity => ({ sub: "sub-default", claimNames: [], ...over });

const provision = (login: string, email = `${login}@demo.example`, extra: Record<string, unknown> = {}) =>
  call(UsersRoute.POST, "POST", "/scim/v2/Users", {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: `${login}@demo.example`,
    externalId: `ext-${login}`,
    name: { givenName: login, familyName: "Tester" },
    emails: [{ value: email, type: "work", primary: true }],
    active: true,
    ...extra,
  });

async function subOf(userId: string) {
  const [u] = await query<{ fixiam_sub: string | null }>("select fixiam_sub from users where id = $1", [userId]);
  return u.fixiam_sub;
}

describe("OIDC identity linking", () => {
  beforeEach(resetDb);

  describe("email strategy (temporary demo)", () => {
    it("matches the verified email claim case-insensitively and stores the stable sub", async () => {
      const u = await provision("amara");
      const r = await linkIdentity(ident({ sub: "fixiam-sub-xyz", email: "AMARA@DEMO.EXAMPLE", emailVerified: true }), null, "email");
      expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email", linkedNow: true, relinked: false });
      expect(await subOf(u.body.id)).toBe("fixiam-sub-xyz");
      const audits = await query("select action, details from audit_logs where action = 'identity.linked' and target_id = $1", [u.body.id]);
      expect(audits).toHaveLength(1);
    });

    it("refuses to link on an UNVERIFIED email", async () => {
      await provision("bisi");
      expect(await linkIdentity(ident({ sub: "s1", email: "bisi@demo.example", emailVerified: false }), null, "email")).toEqual({ ok: false, reason: "email_unverified" });
      // email_verified absent entirely is also treated as unverified
      expect(await linkIdentity(ident({ sub: "s1", email: "bisi@demo.example" }), null, "email")).toEqual({ ok: false, reason: "email_unverified" });
    });

    it("never assumes the sub is an email: with no email claim it does not link", async () => {
      await provision("chidi");
      // sub happens to equal the user's email, but no email claim is present
      expect(await linkIdentity(ident({ sub: "chidi@demo.example" }), null, "email")).toEqual({ ok: false, reason: "not_provisioned" });
    });

    it("denies an inactive account even with a verified email", async () => {
      const u = await provision("dupe-inactive");
      await query("update users set active = false where id = $1", [u.body.id]);
      expect(await linkIdentity(ident({ sub: "s", email: "dupe-inactive@demo.example", emailVerified: true }), null, "email")).toMatchObject({ ok: false, reason: "account_inactive" });
    });

    it("re-links a changed subject for the same verified email (migration path)", async () => {
      const u = await provision("eki");
      await linkIdentity(ident({ sub: "old-email-sub", email: "eki@demo.example", emailVerified: true }), null, "email");
      // Fixiam later switches to an immutable subject; same verified email re-links transparently.
      const r = await linkIdentity(ident({ sub: "new-immutable-id", email: "eki@demo.example", emailVerified: true }), null, "email");
      expect(r).toMatchObject({ ok: true, matchedOn: "email", linkedNow: false, relinked: true });
      expect(await subOf(u.body.id)).toBe("new-immutable-id");
      expect(await query("select 1 from audit_logs where action = 'identity.relinked' and target_id = $1", [u.body.id])).toHaveLength(1);
    });

    it("uses the already-linked subject on repeat logins without re-matching", async () => {
      const u = await provision("femi");
      await linkIdentity(ident({ sub: "stable-femi", email: "femi@demo.example", emailVerified: true }), null, "email");
      // Repeat login: matched by fixiam_sub; email need not even be re-presented.
      const r = await linkIdentity(ident({ sub: "stable-femi" }), null, "email");
      expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "fixiam_sub", linkedNow: false });
    });
  });

  describe("email uniqueness", () => {
    it("rejects a second SCIM user with the same email (case-insensitive) → 409", async () => {
      await provision("gani", "shared@demo.example");
      const dup = await provision("hadiza", "SHARED@demo.example");
      expect(dup.status).toBe(409);
      expect(dup.body.scimType).toBe("uniqueness");
      expect((await query("select count(*)::int as n from users where lower(email) = 'shared@demo.example'"))[0].n).toBe(1);
    });

    it("the database enforces the same invariant (partial unique index)", async () => {
      await provision("ij", "idx@demo.example");
      await expect(
        query("insert into users (user_name, email, provisioning_source) values ('x@demo.example', 'IDX@demo.example', 'scim')"),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  describe("subject strategy (default / target)", () => {
    it("matches externalId == sub and links", async () => {
      const u = await provision("kola");
      const r = await linkIdentity(ident({ sub: "ext-kola", email: "kola@demo.example", emailVerified: true }), null, "subject");
      expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "externalId" });
    });

    it("email fallback still requires a verified email", async () => {
      // userName differs from the email so matching must go through the email fallback.
      const u = await provision("lara", "lara.alt@demo.example");
      // Unverified email, no externalId/userName/preferred_username match → denied.
      expect(await linkIdentity(ident({ sub: "unknown", email: "lara.alt@demo.example", emailVerified: false }), null, "subject")).toEqual({ ok: false, reason: "email_unverified" });
      // Verified email → links via fallback.
      const r = await linkIdentity(ident({ sub: "unknown", email: "lara.alt@demo.example", emailVerified: true }), null, "subject");
      expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email" });
    });

    it("blocks a conflicting subject (different sub claims an already-linked account)", async () => {
      const u = await provision("musa");
      await linkIdentity(ident({ sub: "ext-musa" }), null, "subject"); // links via externalId, stores sub
      // A different subject presents the same userName — not allowed to hijack in subject mode.
      const r = await linkIdentity(ident({ sub: "someone-else", preferredUsername: "musa@demo.example" }), null, "subject");
      expect(r).toMatchObject({ ok: false, reason: "identity_conflict", userId: u.body.id });
    });
  });
});
