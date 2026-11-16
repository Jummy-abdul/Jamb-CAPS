import "server-only";
import { and, count, desc, eq, ilike, isNull, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  applicationRoles,
  groupMemberships,
  groups,
  permissions,
  roleMappings,
  rolePermissions,
  userEntitlements,
  userSessions,
  users,
} from "@/lib/db/schema";

export const PAGE_SIZE = 20;

const effectiveRolesSql = sql<string[]>`coalesce((
  select array_agg(distinct r.name order by r.name)
  from user_entitlements e join application_roles r on r.key = e.role_key
  where e.user_id = ${users.id} and e.revoked_at is null), '{}')`;

const groupNamesSql = sql<string[]>`coalesce((
  select array_agg(g.display_name order by g.display_name)
  from group_memberships m join groups g on g.id = m.group_id and g.deleted_at is null
  where m.user_id = ${users.id}), '{}')`;

export async function listUsers(opts: { q?: string; source?: string; status?: string; page: number }) {
  const db = getDb();
  const where: SQL[] = [];
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(or(ilike(users.userName, like), ilike(users.displayName, like), ilike(users.email, like), ilike(users.department, like))!);
  }
  if (opts.source === "scim" || opts.source === "sample") where.push(eq(users.provisioningSource, opts.source));
  if (opts.status === "active") where.push(and(eq(users.active, true), isNull(users.deletedAt))!);
  if (opts.status === "inactive") where.push(and(eq(users.active, false), isNull(users.deletedAt))!);
  if (opts.status === "deprovisioned") where.push(isNotNull(users.deletedAt));
  const cond = where.length ? and(...where) : undefined;
  const rows = await db
    .select({
      id: users.id, userName: users.userName, displayName: users.displayName, givenName: users.givenName, familyName: users.familyName,
      email: users.email, department: users.department, title: users.title, active: users.active, deletedAt: users.deletedAt,
      source: users.provisioningSource, sampleRoleLabel: users.sampleRoleLabel, lastSyncedAt: users.lastSyncedAt,
      lastLoginAt: users.lastLoginAt, createdAt: users.createdAt, roles: effectiveRolesSql, groups: groupNamesSql,
    })
    .from(users)
    .where(cond)
    // Real Fixiam-provisioned users first, newest first.
    .orderBy(sql`case when ${users.provisioningSource} = 'scim' then 0 else 1 end`, desc(users.createdAt))
    .limit(PAGE_SIZE)
    .offset((opts.page - 1) * PAGE_SIZE);
  const [{ n }] = await db.select({ n: count() }).from(users).where(cond);
  const counts = await db
    .select({ source: users.provisioningSource, n: count() })
    .from(users)
    .where(isNull(users.deletedAt))
    .groupBy(users.provisioningSource);
  return { rows, total: n, counts: Object.fromEntries(counts.map((c) => [c.source, c.n])) as Record<string, number> };
}

export async function getUserDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return null;
  const memberships = await db
    .select({ groupId: groups.id, name: groups.displayName, source: groups.provisioningSource, addedAt: groupMemberships.addedAt })
    .from(groupMemberships)
    .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
    .where(and(eq(groupMemberships.userId, id), isNull(groups.deletedAt)));
  const entitlements = await db
    .select({ e: userEntitlements, roleName: applicationRoles.name })
    .from(userEntitlements)
    .innerJoin(applicationRoles, eq(applicationRoles.key, userEntitlements.roleKey))
    .where(eq(userEntitlements.userId, id))
    .orderBy(desc(userEntitlements.grantedAt));
  const sessions = await db
    .select({ id: userSessions.id, createdAt: userSessions.createdAt, lastSeenAt: userSessions.lastSeenAt, expiresAt: userSessions.expiresAt, revokedAt: userSessions.revokedAt, revokeReason: userSessions.revokeReason, ipAddress: userSessions.ipAddress })
    .from(userSessions)
    .where(eq(userSessions.userId, id))
    .orderBy(desc(userSessions.createdAt))
    .limit(10);
  return { user, memberships, entitlements, sessions };
}

const memberCountSql = sql<number>`(select count(*)::int from group_memberships m where m.group_id = ${groups.id})`;
const mappedRolesSql = sql<string[]>`coalesce((
  select array_agg(distinct r.name order by r.name) from role_mappings rm join application_roles r on r.key = rm.role_key
  where rm.enabled and (
    (rm.source_type = 'group_display_name' and lower(rm.source_value) = lower(${groups.displayName}))
    or (rm.source_type = 'group_external_id' and rm.source_value = ${groups.externalId}))), '{}')`;

export async function listGroups(opts: { q?: string; includeDeleted?: boolean }) {
  const db = getDb();
  const where: SQL[] = [];
  if (!opts.includeDeleted) where.push(isNull(groups.deletedAt));
  if (opts.q) where.push(ilike(groups.displayName, `%${opts.q}%`));
  return db
    .select({
      id: groups.id, displayName: groups.displayName, externalId: groups.externalId, description: groups.description,
      source: groups.provisioningSource, createdAt: groups.createdAt, updatedAt: groups.updatedAt, lastSyncedAt: groups.lastSyncedAt,
      deletedAt: groups.deletedAt, memberCount: memberCountSql, mappedRoles: mappedRolesSql,
    })
    .from(groups)
    .where(where.length ? and(...where) : undefined)
    .orderBy(groups.displayName);
}

export async function getGroupDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [group] = await db.select({
    id: groups.id, displayName: groups.displayName, externalId: groups.externalId, description: groups.description,
    source: groups.provisioningSource, createdAt: groups.createdAt, updatedAt: groups.updatedAt, lastSyncedAt: groups.lastSyncedAt,
    deletedAt: groups.deletedAt, mappedRoles: mappedRolesSql,
  }).from(groups).where(eq(groups.id, id));
  if (!group) return null;
  const members = await db
    .select({ id: users.id, userName: users.userName, displayName: users.displayName, email: users.email, active: users.active, deletedAt: users.deletedAt, addedAt: groupMemberships.addedAt })
    .from(groupMemberships)
    .innerJoin(users, eq(users.id, groupMemberships.userId))
    .where(eq(groupMemberships.groupId, id))
    .orderBy(users.displayName);
  return { group, members };
}

export async function getRolesAndMappings() {
  const db = getDb();
  const roles = await db.select().from(applicationRoles).orderBy(applicationRoles.sortOrder);
  const perms = await db.select().from(permissions).orderBy(permissions.category, permissions.key);
  const rp = await db.select().from(rolePermissions);
  const mappings = await db
    .select({
      m: roleMappings,
      roleName: applicationRoles.name,
      matchedGroups: sql<number>`(select count(*)::int from groups g where g.deleted_at is null and (
        (${roleMappings.sourceType} = 'group_display_name' and lower(g.display_name) = lower(${roleMappings.sourceValue}))
        or (${roleMappings.sourceType} = 'group_external_id' and g.external_id = ${roleMappings.sourceValue})))`,
    })
    .from(roleMappings)
    .innerJoin(applicationRoles, eq(applicationRoles.key, roleMappings.roleKey))
    .orderBy(applicationRoles.sortOrder, roleMappings.sourceValue);
  const assignments = await db
    .select({ roleKey: userEntitlements.roleKey, n: sql<number>`count(distinct ${userEntitlements.userId})::int` })
    .from(userEntitlements)
    .where(isNull(userEntitlements.revokedAt))
    .groupBy(userEntitlements.roleKey);
  return {
    roles,
    permissions: perms,
    matrix: new Set(rp.map((r) => `${r.roleKey}|${r.permissionKey}`)),
    mappings,
    assignmentCounts: Object.fromEntries(assignments.map((a) => [a.roleKey, a.n])) as Record<string, number>,
  };
}

export async function getRoleAssignments() {
  return getDb()
    .select({
      userId: users.id, displayName: users.displayName, userName: users.userName, active: users.active,
      roleName: applicationRoles.name, viaGroup: userEntitlements.sourceGroupName, grantedAt: userEntitlements.grantedAt,
    })
    .from(userEntitlements)
    .innerJoin(users, eq(users.id, userEntitlements.userId))
    .innerJoin(applicationRoles, eq(applicationRoles.key, userEntitlements.roleKey))
    .where(isNull(userEntitlements.revokedAt))
    .orderBy(applicationRoles.sortOrder, users.displayName);
}

export async function getIdentityCounts() {
  const db = getDb();
  const [u] = await db.select({
    scim: sql<number>`count(*) filter (where provisioning_source = 'scim' and deleted_at is null)::int`,
    scimActive: sql<number>`count(*) filter (where provisioning_source = 'scim' and deleted_at is null and active)::int`,
  }).from(users);
  const [g] = await db.select({ n: count() }).from(groups).where(isNull(groups.deletedAt));
  const [s] = await db.select({ n: count() }).from(userSessions).where(and(isNull(userSessions.revokedAt), sql`${userSessions.expiresAt} > now()`));
  return { scimUsers: u.scim, scimActive: u.scimActive, groups: g.n, activeSessions: s.n };
}
