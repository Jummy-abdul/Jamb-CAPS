import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { audit } from "@/lib/audit/log";
import { getOidcAssuredEmailIssuer, getDemoEmailOverride, type OidcMatchStrategy } from "@/lib/env";
import type { FixiamIdentity } from "./oidc";

export type MatchedOn = "fixiam_sub" | "externalId" | "userName" | "email";

/** How the email was determined to be verified, recorded in the audit log. */
export type EmailVerificationSource = "claim" | "provider_assurance" | "none";

/**
 * Decide whether CAPS may treat the identity's email as verified.
 *
 *  - `email_verified: true`  → verified (source "claim").
 *  - `email_verified: false` → NEVER verified, even under provider assurance (source "claim").
 *  - absent → verified ONLY when a trusted issuer is configured AND exactly equals the
 *    cryptographically validated token issuer (source "provider_assurance"); otherwise not
 *    verified (source "none").
 *
 * The decision is centralised here so every caller applies identical, issuer-scoped rules.
 */
export function resolveEmailVerification(
  identity: FixiamIdentity,
  validatedIssuer: string | null,
): { verified: boolean; source: EmailVerificationSource } {
  if (identity.emailVerified === true) return { verified: true, source: "claim" };
  if (identity.emailVerified === false) return { verified: false, source: "claim" };
  const assured = getOidcAssuredEmailIssuer();
  if (assured && validatedIssuer && assured === validatedIssuer) {
    return { verified: true, source: "provider_assurance" };
  }
  return { verified: false, source: "none" };
}

/**
 * DEMO-ONLY: decide whether the tightly-scoped unverified-email exception applies to this
 * identity. It is purely a gate decision and grants NOTHING on its own — the caller still
 * requires a single live, active, SCIM-provisioned account to match. It never alters the
 * verification decision above, and the email is never recorded as verified.
 *
 * Applies only when ALL hold: the exception is enabled; a trusted demo issuer is configured
 * and exactly equals the cryptographically validated token issuer; the token carries an email;
 * and that email is on the explicit address allowlist.
 */
export function demoEmailOverrideApplies(identity: FixiamIdentity, validatedIssuer: string | null): boolean {
  const o = getDemoEmailOverride();
  if (!o.enabled) return false;
  if (!o.issuer || !validatedIssuer || o.issuer !== validatedIssuer) return false;
  const email = identity.email?.trim().toLowerCase();
  if (!email) return false;
  return o.allowlist.has(email);
}

export type LinkResult =
  | { ok: true; userId: string; label: string; matchedOn: MatchedOn; linkedNow: boolean; relinked: boolean; emailVerificationOverride?: boolean }
  | {
      ok: false;
      reason: "not_provisioned" | "account_inactive" | "identity_conflict" | "email_unverified" | "ambiguous_email";
      userId?: string;
      label?: string;
    };

type UserRow = typeof users.$inferSelect;

/**
 * Map an authenticated Fixiam identity to the CAPS account that Fixiam provisioned over SCIM.
 *
 * Matching strategy is configurable (CAPS_OIDC_MATCH_STRATEGY):
 *
 *  - "subject" (default/target): the Fixiam subject is treated as an opaque, immutable
 *    identifier. Order: already-linked fixiam_sub → SCIM externalId == sub → userName
 *    (preferred_username/email) → verified email. This is the strategy to use once Fixiam
 *    exposes an immutable user ID.
 *
 *  - "email" (temporary demo): the verified OIDC email claim is authoritative. Order:
 *    already-linked fixiam_sub → verified email. Used while Fixiam's subject is set to the
 *    user's email. The opaque `sub` is still stored as fixiam_sub so repeat logins are
 *    stable and so a later migration to an immutable subject can re-link transparently.
 *
 * Security invariants (both strategies):
 *  - The OIDC `sub` is never assumed to be an email; email matching uses the explicit
 *    `email` claim only.
 *  - An account is linked by email ONLY when the email is verified, as decided by
 *    resolveEmailVerification (a true claim, or provider assurance for the exact validated
 *    issuer). An explicit `email_verified: false` always refuses.
 *  - Email comparison is case-insensitive, and email uniqueness among live SCIM users is
 *    enforced by a partial unique index, so an email resolves to at most one account.
 */
export async function linkIdentity(
  identity: FixiamIdentity,
  ip: string | null,
  strategy: OidcMatchStrategy,
  validatedIssuer: string | null,
): Promise<LinkResult> {
  // Single, issuer-scoped email-verification decision reused by every match path.
  const emailVerification = resolveEmailVerification(identity, validatedIssuer);
  // DEMO-ONLY: a tightly-scoped exception consulted ONLY when the email is genuinely NOT
  // verified. It never changes `emailVerification` (the recorded truth stays source:"claim",
  // verified:false); it only permits the email-match gate to proceed for an allowlisted,
  // issuer-pinned address. Downstream SCIM/active/uniqueness checks are unchanged.
  const demoOverride = !emailVerification.verified && demoEmailOverrideApplies(identity, validatedIssuer);

  return getDb().transaction(async (tx) => {
    const live = and(eq(users.provisioningSource, "scim"), isNull(users.deletedAt));
    const pick = (cond: ReturnType<typeof sql>) => tx.select().from(users).where(and(live, cond)).for("update");

    let user: UserRow | undefined;
    let matchedOn: MatchedOn = "fixiam_sub";
    let emailSource: EmailVerificationSource = "none";
    // True only when the demo exception was the reason an otherwise-unverified email matched.
    let overrideUsed = false;
    // True when the match itself is the authority for this identity (verified email), which
    // permits re-linking a changed subject (e.g. Fixiam migrating sub -> immutable id).
    let authoritativeMatch = false;

    // 1. Already linked by the stable subject — applies in every strategy.
    [user] = await pick(sql`${users.fixiamSub} = ${identity.sub}`);

    if (!user) {
      if (strategy === "email") {
        const emailMatch = await matchByVerifiedEmail(pick, identity, emailVerification, demoOverride);
        if (!emailMatch.ok) return emailMatch.result;
        user = emailMatch.user;
        matchedOn = "email";
        emailSource = emailVerification.source;
        overrideUsed = demoOverride;
        authoritativeMatch = true;
      } else {
        // subject strategy
        [user] = await pick(sql`${users.externalId} = ${identity.sub}`);
        if (user) matchedOn = "externalId";
        if (!user) {
          // userName candidates: preferred_username always; the email only when verified,
          // so an unverified email cannot link through the userName path either.
          const candidates = [identity.preferredUsername, emailVerification.verified ? identity.email : undefined].filter(Boolean) as string[];
          for (const name of candidates) {
            const rows = await pick(sql`lower(${users.userName}) = lower(${name})`);
            if (rows.length === 1) {
              user = rows[0];
              matchedOn = "userName";
              if (name === identity.email) emailSource = emailVerification.source;
              break;
            }
          }
        }
        if (!user && identity.email) {
          const emailMatch = await matchByVerifiedEmail(pick, identity, emailVerification, demoOverride);
          // In subject strategy email is a fallback: a present-but-unverified email simply
          // doesn't match here (we don't hard-deny, other factors may still apply — but none remain).
          if (emailMatch.ok) {
            user = emailMatch.user;
            matchedOn = "email";
            emailSource = emailVerification.source;
            overrideUsed = demoOverride;
            authoritativeMatch = true;
          } else if (emailMatch.result.reason !== "not_provisioned") {
            return emailMatch.result; // email_unverified / ambiguous_email are hard failures
          }
        }
      }
    }

    if (!user) return { ok: false, reason: "not_provisioned" };

    const label = user.displayName || user.userName;

    // Subject conflict: a different Fixiam subject already owns this account. Allowed to
    // re-link only when the current match is by verified email (the authoritative key).
    const subjectChanged = !!user.fixiamSub && user.fixiamSub !== identity.sub;
    if (subjectChanged && !authoritativeMatch) {
      return { ok: false, reason: "identity_conflict", userId: user.id, label };
    }
    if (!user.active) return { ok: false, reason: "account_inactive", userId: user.id, label };

    const linkedNow = !user.fixiamSub;
    const relinked = subjectChanged; // implies authoritativeMatch
    await tx.update(users).set({ fixiamSub: identity.sub, lastLoginAt: new Date() }).where(eq(users.id, user.id));

    // DEMO-ONLY: record every use of the unverified-email exception with a distinct event,
    // preserving the fact that the original claim was false and the email is NOT verified.
    if (overrideUsed) {
      await audit(
        {
          category: "authentication",
          action: "authentication.demo_email_verification_override",
          outcome: "success",
          actorType: "fixiam_oidc",
          actorLabel: "Fixiam (OIDC)",
          targetType: "user",
          targetId: user.id,
          targetLabel: label,
          ipAddress: ip,
          details: {
            reason: "demo_email_verification_override",
            strategy,
            matchedOn,
            // The ORIGINAL claim as received (false, or null if absent) — verification did NOT pass.
            originalEmailVerifiedClaim: identity.emailVerified ?? null,
            emailVerificationSource: emailVerification.source, // unchanged truth ("claim"=false / "none")
            emailVerified: false, // the exception never asserts the email is verified
            note: "DEMO-ONLY exception: allowlisted, active, SCIM-provisioned user linked despite email_verified:false. Email is NOT represented as verified.",
          },
        },
        tx,
      );
    }

    if (linkedNow || relinked) {
      await audit(
        {
          category: "authentication",
          action: relinked ? "identity.relinked" : "identity.linked",
          actorType: "fixiam_oidc",
          actorLabel: "Fixiam (OIDC)",
          targetType: "user",
          targetId: user.id,
          targetLabel: label,
          ipAddress: ip,
          details: {
            matchedOn,
            strategy,
            // Non-PII: the claim value (bool/null) and how verification was established.
            emailVerified: identity.emailVerified ?? null,
            emailVerificationSource: emailSource,
            note: relinked
              ? "Fixiam subject changed for a verified email; subject re-linked to the existing account"
              : "Fixiam subject linked to the SCIM-provisioned account on first sign-in",
          },
        },
        tx,
      );
    }
    return { ok: true, userId: user.id, label, matchedOn, linkedNow, relinked, emailVerificationOverride: overrideUsed };
  });
}

type EmailMatch =
  | { ok: true; user: UserRow }
  | { ok: false; result: Extract<LinkResult, { ok: false }> };

/**
 * Match a live SCIM user by the verified email claim. Never assumes `sub` is an email.
 * Verification is decided by `resolveEmailVerification` (true claim, or provider assurance
 * for the validated issuer); an explicit `email_verified: false` fails here.
 */
async function matchByVerifiedEmail(
  pick: (cond: ReturnType<typeof sql>) => Promise<UserRow[]>,
  identity: FixiamIdentity,
  verification: { verified: boolean; source: EmailVerificationSource },
  demoOverride = false,
): Promise<EmailMatch> {
  if (!identity.email) return { ok: false, result: { ok: false, reason: "not_provisioned" } };
  // The email-verification gate. The demo exception may permit an otherwise-unverified email
  // to pass THIS gate only; it does not relax the SCIM/active/uniqueness checks that follow,
  // because `pick` still filters to live (provisioning_source='scim', not soft-deleted) rows
  // and the caller enforces `active` and subject-conflict.
  if (!verification.verified && !demoOverride) return { ok: false, result: { ok: false, reason: "email_unverified" } };
  const rows = await pick(sql`lower(${users.email}) = lower(${identity.email})`);
  if (rows.length === 1) return { ok: true, user: rows[0] };
  if (rows.length > 1) return { ok: false, result: { ok: false, reason: "ambiguous_email" } };
  return { ok: false, result: { ok: false, reason: "not_provisioned" } };
}
