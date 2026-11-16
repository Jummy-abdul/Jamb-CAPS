import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { audit } from "@/lib/audit/log";
import type { FixiamIdentity } from "./oidc";

export type LinkResult =
  | { ok: true; userId: string; label: string; matchedOn: "fixiam_sub" | "externalId" | "userName" | "email"; linkedNow: boolean }
  | { ok: false; reason: "not_provisioned" | "account_inactive" | "identity_conflict"; userId?: string; label?: string };

/**
 * Map an authenticated Fixiam identity to the CAPS account that Fixiam provisioned over SCIM.
 *
 * Order: stable OIDC subject (already linked) → SCIM externalId == sub → SCIM userName
 * == preferred_username/email → primary email. The subject is linked on first sign-in
 * and used from then on. Users who were never provisioned cannot sign in.
 */
export async function linkIdentity(identity: FixiamIdentity, ip: string | null): Promise<LinkResult> {
  return getDb().transaction(async (tx) => {
    const live = and(eq(users.provisioningSource, "scim"), isNull(users.deletedAt));
    const pick = async (cond: ReturnType<typeof sql>) => tx.select().from(users).where(and(live, cond)).for("update");

    let matchedOn: "fixiam_sub" | "externalId" | "userName" | "email" = "fixiam_sub";
    let [user] = await pick(sql`${users.fixiamSub} = ${identity.sub}`);
    if (!user) {
      matchedOn = "externalId";
      [user] = await pick(sql`${users.externalId} = ${identity.sub}`);
    }
    if (!user) {
      const names = [identity.preferredUsername, identity.email].filter(Boolean) as string[];
      for (const n of names) {
        const rows = await pick(sql`lower(${users.userName}) = lower(${n})`);
        if (rows.length === 1) { user = rows[0]; matchedOn = "userName"; break; }
      }
    }
    if (!user && identity.email) {
      const rows = await pick(sql`lower(${users.email}) = lower(${identity.email})`);
      if (rows.length === 1) { user = rows[0]; matchedOn = "email"; }
    }
    if (!user) return { ok: false, reason: "not_provisioned" } as const;

    const label = user.displayName || user.userName;
    if (user.fixiamSub && user.fixiamSub !== identity.sub) {
      return { ok: false, reason: "identity_conflict", userId: user.id, label } as const;
    }
    if (!user.active) return { ok: false, reason: "account_inactive", userId: user.id, label } as const;

    const linkedNow = !user.fixiamSub;
    await tx.update(users).set({ fixiamSub: identity.sub, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    if (linkedNow) {
      await audit({
        category: "authentication", action: "identity.linked", actorType: "fixiam_oidc", actorLabel: "Fixiam (OIDC)",
        targetType: "user", targetId: user.id, targetLabel: label, ipAddress: ip,
        details: { matchedOn, note: "Fixiam subject identifier linked to the SCIM-provisioned account on first sign-in" },
      }, tx);
    }
    return { ok: true, userId: user.id, label, matchedOn, linkedNow } as const;
  });
}
