import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { applicationRoles, groupMemberships, groups, roleMappings, userEntitlements, users } from "@/lib/db/schema";
import { audit, type AuditEntry } from "@/lib/audit/log";

type Actor = Pick<AuditEntry, "actorType" | "actorLabel" | "actorUserId">;

interface DesiredGrant {
  roleKey: string;
  roleName: string;
  groupId: string;
  groupName: string;
}

/**
 * Compute the roles a user should hold right now: for every live group the user
 * belongs to, apply every enabled mapping that matches that group.
 * Fixiam owns group membership; CAPS owns only the mapping configuration.
 */
async function desiredGrants(tx: Tx, userId: string): Promise<DesiredGrant[]> {
  const rows = await tx
    .select({
      roleKey: roleMappings.roleKey,
      roleName: applicationRoles.name,
      groupId: groups.id,
      groupName: groups.displayName,
    })
    .from(groupMemberships)
    .innerJoin(groups, and(eq(groups.id, groupMemberships.groupId), isNull(groups.deletedAt)))
    .innerJoin(
      roleMappings,
      and(
        eq(roleMappings.enabled, true),
        sql`(
          (${roleMappings.sourceType} = 'group_display_name' and lower(${roleMappings.sourceValue}) = lower(${groups.displayName}))
          or (${roleMappings.sourceType} = 'group_external_id' and ${groups.externalId} is not null and ${roleMappings.sourceValue} = ${groups.externalId})
        )`,
      ),
    )
    .innerJoin(applicationRoles, eq(applicationRoles.key, roleMappings.roleKey))
    .where(eq(groupMemberships.userId, userId));

  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.roleKey}|${r.groupId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Reconcile the materialised entitlements of one user with the desired state.
 * Grants and revocations are audited. Returns what changed.
 */
export async function recomputeUserEntitlements(tx: Tx, userId: string, actor: Actor, reason: string) {
  const [user] = await tx.select({ id: users.id, label: users.displayName, userName: users.userName }).from(users).where(eq(users.id, userId));
  if (!user) return { granted: [], revoked: [] };
  const label = user.label || user.userName;

  // Serialise concurrent recomputations for the same user.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"entitlements:" + userId}))`);

  const desired = await desiredGrants(tx, userId);
  const active = await tx
    .select()
    .from(userEntitlements)
    .where(and(eq(userEntitlements.userId, userId), isNull(userEntitlements.revokedAt)));

  const key = (roleKey: string, groupId: string | null) => `${roleKey}|${groupId ?? ""}`;
  const desiredKeys = new Set(desired.map((d) => key(d.roleKey, d.groupId)));
  const activeKeys = new Set(active.map((a) => key(a.roleKey, a.sourceGroupId)));

  const toRevoke = active.filter((a) => !desiredKeys.has(key(a.roleKey, a.sourceGroupId)));
  const toGrant = desired.filter((d) => !activeKeys.has(key(d.roleKey, d.groupId)));

  if (toRevoke.length) {
    await tx
      .update(userEntitlements)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(inArray(userEntitlements.id, toRevoke.map((r) => r.id)));
  }
  if (toGrant.length) {
    await tx.insert(userEntitlements).values(
      toGrant.map((g) => ({ userId, roleKey: g.roleKey, sourceGroupId: g.groupId, sourceGroupName: g.groupName })),
    );
  }

  // Effective role set before/after (a role can be granted through several groups).
  const before = new Set(active.map((a) => a.roleKey));
  const after = new Set(desired.map((d) => d.roleKey));
  const roleNames = new Map(desired.map((d) => [d.roleKey, d.roleName]));

  for (const g of toGrant) {
    await audit(
      {
        category: "authorization",
        action: "role.granted",
        ...actor,
        targetType: "user",
        targetId: userId,
        targetLabel: label,
        details: { role: g.roleKey, roleName: g.roleName, viaGroup: g.groupName, reason, newEffectiveRole: !before.has(g.roleKey) },
      },
      tx,
    );
  }
  for (const r of toRevoke) {
    await audit(
      {
        category: "authorization",
        action: "role.revoked",
        ...actor,
        targetType: "user",
        targetId: userId,
        targetLabel: label,
        details: { role: r.roleKey, viaGroup: r.sourceGroupName, reason, roleStillHeldViaOtherGroup: after.has(r.roleKey) },
      },
      tx,
    );
  }

  return {
    granted: toGrant.map((g) => g.roleKey),
    revoked: toRevoke.map((r) => r.roleKey),
    effectiveRoles: [...after].map((k) => ({ key: k, name: roleNames.get(k) ?? k })),
  };
}

/** Recompute every member of a group (after a group rename/delete or a mapping change). */
export async function recomputeGroupMembers(tx: Tx, groupId: string, actor: Actor, reason: string) {
  const members = await tx.select({ userId: groupMemberships.userId }).from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
  for (const m of members) await recomputeUserEntitlements(tx, m.userId, actor, reason);
}

/** Recompute every user who currently holds a grant or belongs to any group. */
export async function recomputeAllEntitlements(tx: Tx, actor: Actor, reason: string) {
  const ids = await tx.execute<{ user_id: string }>(sql`
    select distinct user_id from group_memberships
    union
    select distinct user_id from user_entitlements where revoked_at is null`);
  for (const row of ids) await recomputeUserEntitlements(tx, row.user_id, actor, reason);
}
