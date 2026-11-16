import "server-only";
import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db/client";
import { groupMemberships, groups, users } from "@/lib/db/schema";
import { audit, SCIM_ACTOR } from "@/lib/audit/log";
import { recomputeGroupMembers, recomputeUserEntitlements } from "@/lib/authz/entitlements";
import { ScimError } from "./errors";
import { parseFilter } from "./filter";
import { filterToSql, stringCompare, type AttrMap } from "./filter-sql";
import { applyPatch } from "./patch";
import { GROUP_MULTI_VALUED, SCHEMA_GROUP, SCHEMA_LIST } from "./constants";

type GroupRow = typeof groups.$inferSelect;
type Json = Record<string, unknown>;
type Member = { id: string; userName: string; displayName: string | null };

const isObj = (v: unknown): v is Json => v != null && typeof v === "object" && !Array.isArray(v);
const getCI = (o: Json, k: string) => o[Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GroupInput {
  displayName: string;
  externalId: string | null;
  memberIds: string[];
  extra: Json;
}

export function parseGroupInput(body: unknown): GroupInput {
  if (!isObj(body)) throw ScimError.invalidSyntax("Request body must be a SCIM Group object");
  const dn = getCI(body, "displayName");
  if (typeof dn !== "string" || !dn.trim()) throw ScimError.invalidValue("'displayName' is required");
  if (dn.length > 256) throw ScimError.invalidValue("'displayName' exceeds 256 characters");
  const ext = getCI(body, "externalId");
  if (ext != null && typeof ext !== "string") throw ScimError.invalidValue("'externalId' must be a string");
  const members = getCI(body, "members");
  const memberIds: string[] = [];
  if (members != null) {
    if (!Array.isArray(members)) throw ScimError.invalidValue("'members' must be an array");
    for (const m of members) {
      const v = isObj(m) ? m.value : m;
      if (typeof v !== "string" || !v.trim()) throw ScimError.invalidValue("Each member requires a 'value'");
      if (!memberIds.includes(v.trim())) memberIds.push(v.trim());
    }
  }
  const extra: Json = {};
  for (const [k, v] of Object.entries(body)) {
    if (!["id", "meta", "schemas", "displayname", "externalid", "members"].includes(k.toLowerCase())) extra[k] = v;
  }
  return { displayName: dn.trim(), externalId: typeof ext === "string" && ext.trim() ? ext.trim() : null, memberIds, extra };
}

export function toScimGroup(g: GroupRow, members: Member[] | null, baseUrl: string): Json {
  return {
    schemas: [SCHEMA_GROUP],
    ...(g.scimAttributes ?? {}),
    id: g.id,
    ...(g.externalId ? { externalId: g.externalId } : {}),
    displayName: g.displayName,
    ...(members ? { members: members.map((m) => ({ value: m.id, display: m.displayName || m.userName, type: "User", $ref: `${baseUrl}/Users/${m.id}` })) } : {}),
    meta: {
      resourceType: "Group",
      created: g.createdAt.toISOString(),
      lastModified: g.updatedAt.toISOString(),
      location: `${baseUrl}/Groups/${g.id}`,
      version: `W/"${g.version}"`,
    },
  };
}

/** Members exposed over SCIM: only live, Fixiam-provisioned users. */
async function membersOf(tx: Tx | ReturnType<typeof getDb>, groupIds: string[]) {
  const map = new Map<string, Member[]>();
  if (!groupIds.length) return map;
  const rows = await tx
    .select({ groupId: groupMemberships.groupId, id: users.id, userName: users.userName, displayName: users.displayName })
    .from(groupMemberships)
    .innerJoin(users, and(eq(users.id, groupMemberships.userId), eq(users.provisioningSource, "scim"), isNull(users.deletedAt)))
    .where(inArray(groupMemberships.groupId, groupIds))
    .orderBy(users.userName);
  for (const r of rows) map.set(r.groupId, [...(map.get(r.groupId) ?? []), { id: r.id, userName: r.userName, displayName: r.displayName }]);
  return map;
}

const GROUP_ATTRS: AttrMap = {
  id: { kind: "string", column: sql`${groups.id}::text` },
  displayname: { kind: "string", column: groups.displayName },
  externalid: { kind: "string", column: groups.externalId, caseExact: true },
  "meta.created": { kind: "date", column: groups.createdAt },
  "meta.lastmodified": { kind: "date", column: groups.updatedAt },
  "members.value": {
    kind: "custom",
    build: (op, value) => sql`exists (select 1 from group_memberships gm where gm.group_id = "groups"."id" and ${stringCompare(sql`gm.user_id`, op, value)})`,
  },
  members: {
    kind: "custom",
    build: (op, value) => sql`exists (select 1 from group_memberships gm where gm.group_id = "groups"."id" and ${stringCompare(sql`gm.user_id`, op, value)})`,
  },
};

function wantsMembers(url: URL) {
  const ex = url.searchParams.get("excludedAttributes")?.toLowerCase() ?? "";
  const at = url.searchParams.get("attributes")?.toLowerCase();
  if (ex.split(",").map((s) => s.trim()).includes("members")) return false;
  if (at && !at.split(",").some((s) => s.trim().startsWith("members"))) return false;
  return true;
}

export async function listGroups(url: URL, startIndex: number, count: number, baseUrl: string) {
  const db = getDb();
  const filter = url.searchParams.get("filter");
  const conds: SQL[] = [isNull(groups.deletedAt)];
  if (filter) conds.push(filterToSql(parseFilter(filter), GROUP_ATTRS, SCHEMA_GROUP));
  const where = and(...conds);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(groups).where(where);
  const rows = count === 0 ? [] : await db.select().from(groups).where(where).orderBy(groups.createdAt, groups.id).limit(count).offset(startIndex - 1);
  const m = wantsMembers(url) ? await membersOf(db, rows.map((r) => r.id)) : null;
  return {
    schemas: [SCHEMA_LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((r) => toScimGroup(r, m ? m.get(r.id) ?? [] : null, baseUrl)),
  };
}

async function loadLive(tx: Tx | ReturnType<typeof getDb>, id: string, forUpdate = false) {
  if (!UUID.test(id)) throw ScimError.notFound(`Group ${id} not found`);
  const q = tx.select().from(groups).where(and(eq(groups.id, id), isNull(groups.deletedAt)));
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) throw ScimError.notFound(`Group ${id} not found`);
  return row;
}

export async function getGroup(id: string, url: URL, baseUrl: string) {
  const db = getDb();
  const row = await loadLive(db, id);
  const m = wantsMembers(url) ? await membersOf(db, [row.id]) : null;
  return toScimGroup(row, m ? m.get(row.id) ?? [] : null, baseUrl);
}

async function assertUnique(tx: Tx, input: GroupInput, excludeId?: string) {
  const live = (c: SQL) => (excludeId ? and(c, isNull(groups.deletedAt), ne(groups.id, excludeId)) : and(c, isNull(groups.deletedAt)));
  const [byName] = await tx.select({ id: groups.id }).from(groups).where(live(sql`lower(${groups.displayName}) = lower(${input.displayName})`));
  if (byName) throw ScimError.uniqueness(`A group named '${input.displayName}' already exists`);
  if (input.externalId) {
    const [byExt] = await tx.select({ id: groups.id }).from(groups).where(live(eq(groups.externalId, input.externalId)));
    if (byExt) throw ScimError.uniqueness(`externalId '${input.externalId}' is already in use`);
  }
}

/**
 * Reconcile group membership with the desired member list. Only live,
 * Fixiam-provisioned users can be members; unknown references are skipped and
 * reported. Each change is audited and the affected users' roles recomputed.
 */
async function setMembers(tx: Tx, group: GroupRow, desiredIds: string[], ip: string | null) {
  const validFormat = desiredIds.filter((id) => UUID.test(id));
  const eligible = validFormat.length
    ? await tx
        .select({ id: users.id, label: sql<string>`coalesce(${users.displayName}, ${users.userName})` })
        .from(users)
        .where(and(inArray(users.id, validFormat), eq(users.provisioningSource, "scim"), isNull(users.deletedAt)))
    : [];
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const skipped = desiredIds.filter((id) => !eligibleIds.has(id));

  const current = await tx
    .select({ userId: groupMemberships.userId, label: sql<string>`coalesce(${users.displayName}, ${users.userName})` })
    .from(groupMemberships)
    .innerJoin(users, eq(users.id, groupMemberships.userId))
    .where(eq(groupMemberships.groupId, group.id));
  const currentIds = new Set(current.map((c) => c.userId));

  const toAdd = eligible.filter((e) => !currentIds.has(e.id));
  const toRemove = current.filter((c) => !eligibleIds.has(c.userId));

  if (toAdd.length) await tx.insert(groupMemberships).values(toAdd.map((a) => ({ groupId: group.id, userId: a.id }))).onConflictDoNothing();
  if (toRemove.length) await tx.delete(groupMemberships).where(and(eq(groupMemberships.groupId, group.id), inArray(groupMemberships.userId, toRemove.map((r) => r.userId))));

  for (const a of toAdd) {
    await audit({ category: "group", action: "group.member_added", ...SCIM_ACTOR, ipAddress: ip, targetType: "user", targetId: a.id, targetLabel: a.label, details: { group: group.displayName, groupId: group.id } }, tx);
    await recomputeUserEntitlements(tx, a.id, SCIM_ACTOR, `added to group '${group.displayName}' in Fixiam`);
  }
  for (const r of toRemove) {
    await audit({ category: "group", action: "group.member_removed", ...SCIM_ACTOR, ipAddress: ip, targetType: "user", targetId: r.userId, targetLabel: r.label, details: { group: group.displayName, groupId: group.id, note: "Account remains active; only permissions granted by this group are withdrawn" } }, tx);
    await recomputeUserEntitlements(tx, r.userId, SCIM_ACTOR, `removed from group '${group.displayName}' in Fixiam`);
  }
  if (skipped.length) {
    await audit({ category: "group", action: "group.member_reference_skipped", outcome: "failure", ...SCIM_ACTOR, ipAddress: ip, targetType: "group", targetId: group.id, targetLabel: group.displayName, details: { skippedMemberIds: skipped, reason: "Not a provisioned CAPS user. Users must be provisioned to CAPS before they can be added to a group." } }, tx);
  }
  return { added: toAdd.length, removed: toRemove.length, skipped };
}

function summary(action: string, name: string, r?: { added: number; removed: number; skipped: string[] }) {
  if (!r) return `${action} group '${name}'`;
  const parts = [r.added && `+${r.added} member(s)`, r.removed && `-${r.removed} member(s)`, r.skipped.length && `${r.skipped.length} unknown member(s) skipped`].filter(Boolean);
  return `${action} group '${name}'${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

export async function createGroup(body: unknown, baseUrl: string, ip: string | null) {
  const input = parseGroupInput(body);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"scim-group:" + input.displayName.toLowerCase()}))`);
    await assertUnique(tx, input);
    const [row] = await tx
      .insert(groups)
      .values({ displayName: input.displayName, externalId: input.externalId, provisioningSource: "scim", scimAttributes: input.extra, lastSyncedAt: new Date() })
      .returning();
    await audit({ category: "group", action: "group.created", ...SCIM_ACTOR, ipAddress: ip, targetType: "group", targetId: row.id, targetLabel: row.displayName, details: { externalId: row.externalId } }, tx);
    const r = await setMembers(tx, row, input.memberIds, ip);
    const m = await membersOf(tx, [row.id]);
    return { resource: toScimGroup(row, m.get(row.id) ?? [], baseUrl), summary: summary("Created", row.displayName, r), id: row.id };
  });
}

async function persistReplacement(tx: Tx, current: GroupRow, input: GroupInput, baseUrl: string, ip: string | null, via: "PUT" | "PATCH", membersSpecified: boolean) {
  await assertUnique(tx, input, current.id);
  const renamed = current.displayName !== input.displayName;
  const extChanged = (current.externalId ?? null) !== input.externalId;
  const now = new Date();
  const [row] = await tx
    .update(groups)
    .set({
      displayName: input.displayName, externalId: input.externalId, scimAttributes: input.extra, lastSyncedAt: now,
      ...(renamed || extChanged ? { updatedAt: now, version: sql`${groups.version} + 1` } : {}),
    })
    .where(eq(groups.id, current.id))
    .returning();
  if (renamed || extChanged) {
    await audit({ category: "group", action: "group.updated", ...SCIM_ACTOR, ipAddress: ip, targetType: "group", targetId: row.id, targetLabel: row.displayName, details: { via, ...(renamed ? { displayName: { from: current.displayName, to: row.displayName } } : {}), ...(extChanged ? { externalId: { from: current.externalId, to: row.externalId } } : {}) } }, tx);
  }
  // A rename can change which role mappings match this group.
  if (renamed || extChanged) await recomputeGroupMembers(tx, row.id, SCIM_ACTOR, `group renamed in Fixiam ('${current.displayName}' → '${row.displayName}')`);
  const r = membersSpecified ? await setMembers(tx, row, input.memberIds, ip) : undefined;
  if (r && (r.added || r.removed)) await tx.update(groups).set({ updatedAt: now, version: sql`${groups.version} + 1` }).where(eq(groups.id, row.id));
  const m = await membersOf(tx, [row.id]);
  const [fresh] = await tx.select().from(groups).where(eq(groups.id, row.id));
  return { resource: toScimGroup(fresh, m.get(row.id) ?? [], baseUrl), summary: summary(via === "PUT" ? "Replaced" : "Patched", row.displayName, r), id: row.id };
}

export async function replaceGroup(id: string, body: unknown, baseUrl: string, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const current = await loadLive(tx, id, true);
    if (isObj(body) && body.id !== undefined && body.id !== current.id) throw ScimError.mutability("'id' is immutable");
    const input = parseGroupInput(body);
    // PUT replaces the whole resource: an omitted members attribute means no members.
    return persistReplacement(tx, current, input, baseUrl, ip, "PUT", true);
  });
}

export async function patchGroup(id: string, body: unknown, baseUrl: string, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const current = await loadLive(tx, id, true);
    const m = await membersOf(tx, [current.id]);
    const before = toScimGroup(current, m.get(current.id) ?? [], baseUrl);
    const after = applyPatch(before, body, { multiValued: GROUP_MULTI_VALUED, coreSchemas: [SCHEMA_GROUP] });
    if (after.id !== current.id) throw ScimError.mutability("'id' is immutable");
    return persistReplacement(tx, current, parseGroupInput(after), baseUrl, ip, "PATCH", true);
  });
}

export async function deleteGroup(id: string, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const current = await loadLive(tx, id, true);
    const members = await tx.select({ userId: groupMemberships.userId }).from(groupMemberships).where(eq(groupMemberships.groupId, current.id));
    const now = new Date();
    await tx.update(groups).set({ deletedAt: now, updatedAt: now, lastSyncedAt: now }).where(eq(groups.id, current.id));
    await tx.delete(groupMemberships).where(eq(groupMemberships.groupId, current.id));
    await audit({ category: "group", action: "group.deleted", ...SCIM_ACTOR, ipAddress: ip, targetType: "group", targetId: current.id, targetLabel: current.displayName, details: { membersRemoved: members.length } }, tx);
    for (const mbr of members) await recomputeUserEntitlements(tx, mbr.userId, SCIM_ACTOR, `group '${current.displayName}' deleted in Fixiam`);
    return { id: current.id, name: current.displayName };
  });
}
