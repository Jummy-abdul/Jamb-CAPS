import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { audit } from "@/lib/audit/log";
import type { OidcMatchStrategy } from "@/lib/env";
import type { FixiamIdentity } from "./oidc";

export type MatchedOn = "fixiam_sub" | "externalId" | "userName" | "email";

export type LinkResult =
  | { ok: true; userId: string; label: string; matchedOn: MatchedOn; linkedNow: boolean; relinked: boolean }
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
 *  - An account is linked by email ONLY when `email_verified` is true.
 *  - Email comparison is case-insensitive, and email uniqueness among live SCIM users is
 *    enforced by a partial unique index, so an email resolves to at most one account.
 */
export async function linkIdentity(
  identity: FixiamIdentity,
  ip: string | null,
  strategy: OidcMatchStrategy,
): Promise<LinkResult> {
  return getDb().transaction(async (tx) => {
    const live = and(eq(users.provisioningSource, "scim"), isNull(users.deletedAt));
    const pick = (cond: ReturnType<typeof sql>) => tx.select().from(users).where(and(live, cond)).for("update");

    let user: UserRow | undefined;
    let matchedOn: MatchedOn = "fixiam_sub";
    // True when the match itself is the authority for this identity (verified email), which
    // permits re-linking a changed subject (e.g. Fixiam migrating sub -> immutable id).
    let authoritativeMatch = false;

    // 1. Already linked by the stable subject — applies in every strategy.
    [user] = await pick(sql`${users.fixiamSub} = ${identity.sub}`);

    if (!user) {
      if (strategy === "email") {
        const emailMatch = await matchByVerifiedEmail(pick, identity);
        if (!emailMatch.ok) return emailMatch.result;
        user = emailMatch.user;
        matchedOn = "email";
        authoritativeMatch = true;
      } else {
        // subject strategy
        [user] = await pick(sql`${users.externalId} = ${identity.sub}`);
        if (user) matchedOn = "externalId";
        if (!user) {
          // userName candidates: preferred_username always; the email only when verified,
          // so an unverified email cannot link through the userName path either.
          const candidates = [identity.preferredUsername, identity.emailVerified === true ? identity.email : undefined].filter(Boolean) as string[];
          for (const name of candidates) {
            const rows = await pick(sql`lower(${users.userName}) = lower(${name})`);
            if (rows.length === 1) {
              user = rows[0];
              matchedOn = "userName";
              break;
            }
          }
        }
        if (!user && identity.email) {
          const emailMatch = await matchByVerifiedEmail(pick, identity);
          // In subject strategy email is a fallback: a present-but-unverified email simply
          // doesn't match here (we don't hard-deny, other factors may still apply — but none remain).
          if (emailMatch.ok) {
            user = emailMatch.user;
            matchedOn = "email";
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
            emailVerified: identity.emailVerified ?? null,
            note: relinked
              ? "Fixiam subject changed for a verified email; subject re-linked to the existing account"
              : "Fixiam subject linked to the SCIM-provisioned account on first sign-in",
          },
        },
        tx,
      );
    }
    return { ok: true, userId: user.id, label, matchedOn, linkedNow, relinked };
  });
}

type EmailMatch =
  | { ok: true; user: UserRow }
  | { ok: false; result: Extract<LinkResult, { ok: false }> };

/** Match a live SCIM user by the verified email claim. Never assumes `sub` is an email. */
async function matchByVerifiedEmail(
  pick: (cond: ReturnType<typeof sql>) => Promise<UserRow[]>,
  identity: FixiamIdentity,
): Promise<EmailMatch> {
  if (!identity.email) return { ok: false, result: { ok: false, reason: "not_provisioned" } };
  // Requirement: never link based on an unverified email.
  if (identity.emailVerified !== true) return { ok: false, result: { ok: false, reason: "email_unverified" } };
  const rows = await pick(sql`lower(${users.email}) = lower(${identity.email})`);
  if (rows.length === 1) return { ok: true, user: rows[0] };
  if (rows.length > 1) return { ok: false, result: { ok: false, reason: "ambiguous_email" } };
  return { ok: false, result: { ok: false, reason: "not_provisioned" } };
}
