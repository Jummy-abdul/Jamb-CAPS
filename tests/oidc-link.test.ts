import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as UsersRoute from "@/app/scim/v2/Users/route";
import { call, query, resetDb } from "./helpers";
import { linkIdentity, resolveEmailVerification } from "@/lib/auth/link";
import type { FixiamIdentity } from "@/lib/auth/oidc";

const ISS = "https://idp.test";
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
      const r = await linkIdentity(ident({ sub: "fixiam-sub-xyz", email: "AMARA@DEMO.EXAMPLE", emailVerified: true }), null, "email", ISS);
      expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email", linkedNow: true, relinked: false });
      expect(await subOf(u.body.id)).toBe("fixiam-sub-xyz");
      const audits = await query("select action, details from audit_logs where action = 'identity.linked' and target_id = $1", [u.body.id]);
      expect(audits).toHaveLength(1);
    });

    it("refuses to link on an UNVERIFIED email", async () => {
      await provision("bisi");
      expect(await linkIdentity(ident({ sub: "s1", email: "bisi@demo.example", emailVerified: false }), null, "email", ISS)).toEqual({ ok: false, reason: "email_unverified" });
      // email_verified absent entirely is also treated as unverified
      expect(await linkIdentity(ident({ sub: "s1", email: "bisi@demo.example" }), null, "email", ISS)).toEqual({ ok: false, reason: "email_unverified" });
    });

    it("never assumes the sub is an email: with no email claim it does not link", async () => {
      await provision("chidi");
      // sub happens to equal the user's email, but no email claim is present
      expect(await linkIdentity(ident({ sub: "chidi@demo.example" }), null, "email", ISS)).toEqual({ ok: false, reason: "not_provisioned" });
    });

    it("denies an inactive account even with a verified email", async () => {
      const u = await provision("dupe-inactive");
      await query("update users set active = false where id = $1", [u.body.id]);
      expect(await linkIdentity(ident({ sub: "s", email: "dupe-inactive@demo.example", emailVerified: true }), null, "email", ISS)).toMatchObject({ ok: false, reason: "account_inactive" });
    });

    it("re-links a changed subject for the same verified email (migration path)", async () => {
      const u = await provision("eki");
      await linkIdentity(ident({ sub: "old-email-sub", email: "eki@demo.example", emailVerified: true }), null, "email", ISS);
      // Fixiam later switches to an immutable subject; same verified email re-links transparently.
      const r = await linkIdentity(ident({ sub: "new-immutable-id", email: "eki@demo.example", emailVerified: true }), null, "email", ISS);
      expect(r).toMatchObject({ ok: true, matchedOn: "email", linkedNow: false, relinked: true });
      expect(await subOf(u.body.id)).toBe("new-immutable-id");
      expect(await query("select 1 from audit_logs where action = 'identity.relinked' and target_id = $1", [u.body.id])).toHaveLength(1);
    });

    it("uses the already-linked subject on repeat logins without re-matching", async () => {
      const u = await provision("femi");
      await linkIdentity(ident({ sub: "stable-femi", email: "femi@demo.example", emailVerified: true }), null, "email", ISS);
      // Repeat login: matched by fixiam_sub; email need not even be re-presented.
      const r = await linkIdentity(ident({ sub: "stable-femi" }), null, "email", ISS);
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
      const r = await linkIdentity(ident({ sub: "ext-kola", email: "kola@demo.example", emailVerified: true }), null, "subject", ISS);
      expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "externalId" });
    });

    it("email fallback still requires a verified email", async () => {
      // userName differs from the email so matching must go through the email fallback.
      const u = await provision("lara", "lara.alt@demo.example");
      // Unverified email, no externalId/userName/preferred_username match → denied.
      expect(await linkIdentity(ident({ sub: "unknown", email: "lara.alt@demo.example", emailVerified: false }), null, "subject", ISS)).toEqual({ ok: false, reason: "email_unverified" });
      // Verified email → links via fallback.
      const r = await linkIdentity(ident({ sub: "unknown", email: "lara.alt@demo.example", emailVerified: true }), null, "subject", ISS);
      expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email" });
    });

    it("blocks a conflicting subject (different sub claims an already-linked account)", async () => {
      const u = await provision("musa");
      await linkIdentity(ident({ sub: "ext-musa" }), null, "subject", ISS); // links via externalId, stores sub
      // A different subject presents the same userName — not allowed to hijack in subject mode.
      const r = await linkIdentity(ident({ sub: "someone-else", preferredUsername: "musa@demo.example" }), null, "subject", ISS);
      expect(r).toMatchObject({ ok: false, reason: "identity_conflict", userId: u.body.id });
    });
  });
});

describe("provider-assured email verification (Fixiam temporary trust)", () => {
  const ASSURED = "https://fixiam.issuer.example";
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER;
  });

  it("links when email_verified is ABSENT and the validated issuer is the trusted issuer", async () => {
    process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER = ASSURED;
    const u = await provision("nkem");
    // sub equals the email (Fixiam demo), but CAPS matches on the explicit email claim, not sub.
    const r = await linkIdentity(ident({ sub: "nkem@demo.example", email: "nkem@demo.example" }), null, "email", ASSURED);
    expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email" });
    const [a] = await query<{ details: Record<string, unknown> }>("select details from audit_logs where action='identity.linked' and target_id=$1", [u.body.id]);
    expect(a.details.emailVerificationSource).toBe("provider_assurance");
  });

  it("does NOT link when the validated issuer differs from the trusted issuer", async () => {
    process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER = ASSURED;
    await provision("obi");
    expect(await linkIdentity(ident({ sub: "obi@demo.example", email: "obi@demo.example" }), null, "email", "https://someone-else.example")).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("does NOT link when no trusted issuer is configured (default safety preserved)", async () => {
    await provision("peace");
    expect(await linkIdentity(ident({ sub: "peace@demo.example", email: "peace@demo.example" }), null, "email", ASSURED)).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("ALWAYS rejects an explicit email_verified:false, even under assurance", async () => {
    process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER = ASSURED;
    await provision("quadri");
    expect(await linkIdentity(ident({ sub: "quadri@demo.example", email: "quadri@demo.example", emailVerified: false }), null, "email", ASSURED)).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("email_verified:true links via the claim regardless of the assurance setting", async () => {
    const u = await provision("rita"); // assurance NOT set
    const r = await linkIdentity(ident({ sub: "rita@demo.example", email: "rita@demo.example", emailVerified: true }), null, "email", "https://any.example");
    expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email" });
    const [a] = await query<{ details: Record<string, unknown> }>("select details from audit_logs where action='identity.linked' and target_id=$1", [u.body.id]);
    expect(a.details.emailVerificationSource).toBe("claim");
  });

  it("subject strategy honours provider assurance for the email fallback", async () => {
    process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER = ASSURED;
    const u = await provision("sade", "sade.alt@demo.example");
    const r = await linkIdentity(ident({ sub: "unknown-sub", email: "sade.alt@demo.example" }), null, "subject", ASSURED);
    expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email" });
  });

  it("resolveEmailVerification decision matrix is issuer-scoped", () => {
    process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER = ASSURED;
    expect(resolveEmailVerification(ident({ sub: "x", emailVerified: true }), "https://other")).toEqual({ verified: true, source: "claim" });
    expect(resolveEmailVerification(ident({ sub: "x", emailVerified: false }), ASSURED)).toEqual({ verified: false, source: "claim" });
    expect(resolveEmailVerification(ident({ sub: "x" }), ASSURED)).toEqual({ verified: true, source: "provider_assurance" });
    expect(resolveEmailVerification(ident({ sub: "x" }), "https://other")).toEqual({ verified: false, source: "none" });
    expect(resolveEmailVerification(ident({ sub: "x" }), null)).toEqual({ verified: false, source: "none" });
    delete process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER;
    expect(resolveEmailVerification(ident({ sub: "x" }), ASSURED)).toEqual({ verified: false, source: "none" });
  });
});

describe("demo-only unverified-email exception (tightly scoped)", () => {
  const ALLOWED = "jumoke+jamb@fixiamlab.com";
  const DEMO_ISS = "https://jamb.iam.seamfix.com/realms/jamb";

  beforeEach(async () => {
    await resetDb();
    process.env.CAPS_DEMO_ALLOW_UNVERIFIED_EMAIL = "true";
    process.env.CAPS_DEMO_UNVERIFIED_EMAIL_ALLOWLIST = ALLOWED;
    process.env.CAPS_DEMO_UNVERIFIED_EMAIL_ISSUER = DEMO_ISS;
  });
  afterEach(() => {
    delete process.env.CAPS_DEMO_ALLOW_UNVERIFIED_EMAIL;
    delete process.env.CAPS_DEMO_UNVERIFIED_EMAIL_ALLOWLIST;
    delete process.env.CAPS_DEMO_UNVERIFIED_EMAIL_ISSUER;
  });

  it("1. allowlisted, active, SCIM-provisioned user with email_verified:false links via the exception", async () => {
    const u = await provision("olajumoke", ALLOWED);
    const r = await linkIdentity(ident({ sub: "fixiam-olajumoke", email: ALLOWED, emailVerified: false }), null, "email", DEMO_ISS);
    expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email", emailVerificationOverride: true });
    // Distinct audit event recorded, preserving that the original claim was false and the
    // true verification source is unchanged (never represented as verified).
    const [ov] = await query<{ details: Record<string, unknown> }>(
      "select details from audit_logs where action = 'authentication.demo_email_verification_override' and target_id = $1",
      [u.body.id],
    );
    expect(ov.details).toMatchObject({
      reason: "demo_email_verification_override",
      originalEmailVerifiedClaim: false,
      emailVerified: false,
      emailVerificationSource: "claim",
    });
    // The opaque subject is stored, so subsequent logins match by fixiam_sub and never touch the gate.
    expect(await subOf(u.body.id)).toBe("fixiam-olajumoke");
  });

  it("2. same user with email_verified:true links normally (exception not used, no override event)", async () => {
    const u = await provision("olajumoke", ALLOWED);
    const r = await linkIdentity(ident({ sub: "fixiam-olajumoke", email: ALLOWED, emailVerified: true }), null, "email", DEMO_ISS);
    expect(r).toMatchObject({ ok: true, userId: u.body.id, matchedOn: "email" });
    expect((r as { emailVerificationOverride?: boolean }).emailVerificationOverride).toBeFalsy();
    expect(await query("select 1 from audit_logs where action = 'authentication.demo_email_verification_override'")).toHaveLength(0);
  });

  it("3. non-allowlisted user with email_verified:false is rejected", async () => {
    await provision("bisi", "bisi@demo.example");
    expect(await linkIdentity(ident({ sub: "s", email: "bisi@demo.example", emailVerified: false }), null, "email", DEMO_ISS))
      .toEqual({ ok: false, reason: "email_unverified" });
  });

  it("4. allowlisted email that is NOT SCIM-provisioned is rejected", async () => {
    // No provisioning: the exception passes the gate but no live SCIM account exists.
    expect(await linkIdentity(ident({ sub: "s", email: ALLOWED, emailVerified: false }), null, "email", DEMO_ISS))
      .toEqual({ ok: false, reason: "not_provisioned" });
  });

  it("5. allowlisted but inactive user is rejected", async () => {
    const u = await provision("olajumoke", ALLOWED);
    await query("update users set active = false where id = $1", [u.body.id]);
    expect(await linkIdentity(ident({ sub: "s", email: ALLOWED, emailVerified: false }), null, "email", DEMO_ISS))
      .toMatchObject({ ok: false, reason: "account_inactive", userId: u.body.id });
  });

  it("6. a different validated issuer is rejected", async () => {
    await provision("olajumoke", ALLOWED);
    expect(await linkIdentity(ident({ sub: "s", email: ALLOWED, emailVerified: false }), null, "email", "https://not-fixiam.example"))
      .toEqual({ ok: false, reason: "email_unverified" });
  });

  it("7. with the exception disabled, normal verification rules apply", async () => {
    delete process.env.CAPS_DEMO_ALLOW_UNVERIFIED_EMAIL;
    await provision("olajumoke", ALLOWED);
    expect(await linkIdentity(ident({ sub: "s", email: ALLOWED, emailVerified: false }), null, "email", DEMO_ISS))
      .toEqual({ ok: false, reason: "email_unverified" });
  });

  it("8. duplicate email cannot exist (uniqueness preserved), so the exception never faces an ambiguous match", async () => {
    await provision("olajumoke", ALLOWED);
    const dup = await provision("olajumoke2", ALLOWED);
    expect(dup.status).toBe(409);
    expect(dup.body.scimType).toBe("uniqueness");
    expect((await query("select count(*)::int as n from users where lower(email) = lower($1)", [ALLOWED]))[0].n).toBe(1);
  });

  it("does not widen to a bare domain or wildcard (allowlist parser drops them → inert)", async () => {
    process.env.CAPS_DEMO_UNVERIFIED_EMAIL_ALLOWLIST = "*, , fixiamlab.com, @fixiamlab.com";
    await provision("olajumoke", ALLOWED);
    expect(await linkIdentity(ident({ sub: "s", email: ALLOWED, emailVerified: false }), null, "email", DEMO_ISS))
      .toEqual({ ok: false, reason: "email_unverified" });
  });

  it("an explicit email_verified:false is still refused for everyone outside the allowlist, even under provider assurance", async () => {
    // The exception must not become a global policy: a different allowlisted-issuer user is still denied.
    process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER = DEMO_ISS;
    await provision("chidi", "chidi@demo.example");
    expect(await linkIdentity(ident({ sub: "s", email: "chidi@demo.example", emailVerified: false }), null, "email", DEMO_ISS))
      .toEqual({ ok: false, reason: "email_unverified" });
    delete process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER;
  });
});
