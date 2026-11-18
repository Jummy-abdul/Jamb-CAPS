import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { applicationRoles, groupMemberships, groups, roleMappings, userEntitlements, users } from "@/lib/db/schema";
import { audit, type AuditEntry } from "@/lib/audit/log";

type Actor = Pick<AuditEntry, "actorType" | "actorLabel" | "actorUserId">;

type SourceKind = "group" | "application_role";

interface DesiredGrant {
  roleKey: string;
  roleName: string;
  /** What conferred the grant. */
  sourceKind: SourceKind;
  /** Stable reference within the source: group id ('group') or lowercased external role value ('application_role'). */
  sourceRef: string;
  /** Group columns (kept for group grants only, for display + FK). */
  sourceGroupId: string | null;
  sourceGroupName: string | null;
  /** The external Fixiam application-role value (application_role grants only), for audit. */
  externalRole?: string;
}

/**
 * Compute the roles a user should hold right now — the UNION of two Fixiam-owned,
 * SCIM-provisioned sources, each mapped to internal roles by CAPS-owned configuration:
 *   1. Group membership → role_mappings(group_display_name | group_external_id).
 *   2. Provisioned application roles (users.provisioned_app_roles) → role_mappings(application_role).
 * CAPS owns only the mapping; Fixiam owns the assignments. An unmapped source grants nothing.
 */
async function desiredGrants(tx: Tx, userId: string): Promise<DesiredGrant[]> {
  // A non-live or inactive user is entitled to nothing. This makes reconciliation revoke all
  // access on deactivation (active=false) and deprovision (soft delete), from either source.
  const [u] = await tx
    .select({ active: users.active, deletedAt: users.deletedAt, roles: users.provisionedAppRoles })
    .from(users)
    .where(eq(users.id, userId));
  if (!u || !u.active || u.deletedAt) return [];

  const grants: DesiredGrant[] = [];

  // 1. Group-derived.
  const groupRows = await tx
    .select({ roleKey: roleMappings.roleKey, roleName: applicationRoles.name, groupId: groups.id, groupName: groups.displayName })
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
  for (const r of groupRows) {
    grants.push({ roleKey: r.roleKey, roleName: r.roleName, sourceKind: "group", sourceRef: r.groupId, sourceGroupId: r.groupId, sourceGroupName: r.groupName });
  }

  // 2. Application-role-derived.
  const values = [...new Set((u.roles ?? []).map((r) => r.value.trim().toLowerCase()).filter(Boolean))];
  if (values.length) {
    const roleRows = await tx
      .select({ roleKey: roleMappings.roleKey, roleName: applicationRoles.name, sourceValue: roleMappings.sourceValue })
      .from(roleMappings)
      .innerJoin(applicationRoles, eq(applicationRoles.key, roleMappings.roleKey))
      .where(
        and(
          eq(roleMappings.enabled, true),
          eq(roleMappings.sourceType, "application_role"),
          sql`lower(${roleMappings.sourceValue}) in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`,
        ),
      );
    for (const r of roleRows) {
      grants.push({ roleKey: r.roleKey, roleName: r.roleName, sourceKind: "application_role", sourceRef: r.sourceValue.trim().toLowerCase(), sourceGroupId: null, sourceGroupName: null, externalRole: r.sourceValue });
    }
  }

  // De-duplicate by (roleKey, sourceKind, sourceRef).
  const seen = new Set<string>();
  return grants.filter((g) => {
    const k = `${g.roleKey}|${g.sourceKind}|${g.sourceRef}`;
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

  const key = (roleKey: string, sourceKind: string, sourceRef: string | null) => `${roleKey}|${sourceKind}|${sourceRef ?? ""}`;
  const desiredKeys = new Set(desired.map((d) => key(d.roleKey, d.sourceKind, d.sourceRef)));
  const activeKeys = new Set(active.map((a) => key(a.roleKey, a.sourceKind, a.sourceRef)));

  const toRevoke = active.filter((a) => !desiredKeys.has(key(a.roleKey, a.sourceKind, a.sourceRef)));
  const toGrant = desired.filter((d) => !activeKeys.has(key(d.roleKey, d.sourceKind, d.sourceRef)));

  if (toRevoke.length) {
    await tx
      .update(userEntitlements)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(inArray(userEntitlements.id, toRevoke.map((r) => r.id)));
  }
  if (toGrant.length) {
    await tx.insert(userEntitlements).values(
      toGrant.map((g) => ({ userId, roleKey: g.roleKey, sourceKind: g.sourceKind, sourceRef: g.sourceRef, sourceGroupId: g.sourceGroupId, sourceGroupName: g.sourceGroupName })),
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
        details: {
          role: g.roleKey,
          roleName: g.roleName,
          source: g.sourceKind, // 'group' | 'application_role'
          via: g.sourceKind === "group" ? g.sourceGroupName : g.externalRole,
          reason,
          newEffectiveRole: !before.has(g.roleKey),
        },
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
        details: {
          role: r.roleKey,
          source: r.sourceKind, // 'group' | 'application_role'
          via: r.sourceKind === "group" ? r.sourceGroupName : r.sourceRef,
          reason,
          roleStillHeldViaOtherSource: after.has(r.roleKey),
        },
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
