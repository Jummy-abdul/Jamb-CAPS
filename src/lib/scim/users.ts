import "server-only";
import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db/client";
import { groupMemberships, groups, users } from "@/lib/db/schema";
import { audit, SCIM_ACTOR } from "@/lib/audit/log";
import { revokeUserSessions } from "@/lib/auth/session";
import { recomputeUserEntitlements } from "@/lib/authz/entitlements";
import { ScimError } from "./errors";
import { parseFilter } from "./filter";
import { filterToSql, stringCompare, type AttrMap } from "./filter-sql";
import { applyPatch } from "./patch";
import { SCHEMA_ENTERPRISE_USER, SCHEMA_FIXIAM_AUTHZ, SCHEMA_LIST, SCHEMA_USER, USER_MULTI_VALUED } from "./constants";

/** A Fixiam application-role assignment extracted from the SCIM representation. */
export type ProvisionedAppRole = { value: string; display?: string; source: "roles" | "ext" | "both" };

/**
 * Extract Fixiam application-role assignments from a SCIM User representation as a normalised,
 * de-duplicated union of two provisioning formats (requirement: process both, dedupe):
 *   - the standard `roles` multi-valued attribute (entries typed "appRole", or untyped);
 *   - the Fixiam authorization extension's `appRoles` string array.
 * Values are de-duplicated case-insensitively; `source` records which format(s) carried each.
 * This is authorization input only — it never asserts verification or identity.
 */
export function parseProvisionedAppRoles(body: Json): ProvisionedAppRole[] {
  const byKey = new Map<string, ProvisionedAppRole>();
  const roles = getCI(body, "roles");
  if (Array.isArray(roles)) {
    for (const r of roles) {
      if (!isObj(r)) continue;
      const type = typeof r.type === "string" ? r.type.trim().toLowerCase() : undefined;
      if (type && type !== "approle") continue; // only application roles; ignore other role types
      const value = typeof r.value === "string" ? r.value.trim() : "";
      if (!value) continue;
      const display = typeof r.display === "string" && r.display.trim() ? r.display.trim() : undefined;
      const k = value.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, { value, display, source: "roles" });
    }
  }
  const ext = getCI(body, SCHEMA_FIXIAM_AUTHZ);
  if (isObj(ext)) {
    const appRoles = getCI(ext, "appRoles");
    if (Array.isArray(appRoles)) {
      for (const v of appRoles) {
        const value = typeof v === "string" ? v.trim() : "";
        if (!value) continue;
        const k = value.toLowerCase();
        const existing = byKey.get(k);
        if (existing) existing.source = "both";
        else byKey.set(k, { value, source: "ext" });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/** Stable, order-independent signature of an app-role set, for change detection. */
function appRolesSignature(roles: ProvisionedAppRole[] | null | undefined): string {
  return (roles ?? []).map((r) => r.value.toLowerCase()).sort().join("\u0000");
}

type UserRow = typeof users.$inferSelect;
type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => v != null && typeof v === "object" && !Array.isArray(v);
const getCI = (o: Json, k: string) => o[Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k];

function str(v: unknown, field: string, max = 256): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") throw ScimError.invalidValue(`'${field}' must be a string`);
  const s = String(v).trim();
  if (s.length > max) throw ScimError.invalidValue(`'${field}' exceeds ${max} characters`);
  return s || null;
}

function bool(v: unknown, field: string, def: boolean): boolean {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && ["true", "false"].includes(v.toLowerCase())) return v.toLowerCase() === "true";
  throw ScimError.invalidValue(`'${field}' must be a boolean`);
}

/** Validated, normalised user attributes extracted from a SCIM User representation. */
interface UserInput {
  userName: string;
  externalId: string | null;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
  email: string | null;
  title: string | null;
  department: string | null;
  active: boolean;
  extra: Json;
  provisionedAppRoles: ProvisionedAppRole[];
}

const MODELED = new Set(["id", "meta", "schemas", "username", "externalid", "name", "displayname", "emails", "active", "title", "groups", "password", "department", SCHEMA_ENTERPRISE_USER.toLowerCase()]);

export function parseUserInput(body: unknown): UserInput {
  if (!isObj(body)) throw ScimError.invalidSyntax("Request body must be a SCIM User object");
  const userName = str(getCI(body, "userName"), "userName");
  if (!userName) throw ScimError.invalidValue("'userName' is required");
  const name = getCI(body, "name");
  const nameObj = isObj(name) ? name : {};
  const givenName = str(getCI(nameObj, "givenName"), "name.givenName");
  const familyName = str(getCI(nameObj, "familyName"), "name.familyName");
  const formatted = str(getCI(nameObj, "formatted"), "name.formatted");

  const emailsRaw = getCI(body, "emails");
  let email: string | null = null;
  if (emailsRaw !== undefined && emailsRaw !== null) {
    if (!Array.isArray(emailsRaw)) throw ScimError.invalidValue("'emails' must be an array");
    const valid = emailsRaw.filter((e) => isObj(e) && typeof e.value === "string") as Json[];
    const primary = valid.find((e) => e.primary === true || e.primary === "true") ?? valid.find((e) => String(e.type).toLowerCase() === "work") ?? valid[0];
    email = primary ? str(primary.value, "emails.value", 320) : null;
  }

  const ent = getCI(body, SCHEMA_ENTERPRISE_USER);
  const department = str(isObj(ent) ? getCI(ent, "department") : undefined, "department") ?? str(getCI(body, "department"), "department");

  const extra: Json = {};
  for (const [k, v] of Object.entries(body)) if (!MODELED.has(k.toLowerCase())) extra[k] = v;
  if (isObj(ent)) {
    const rest = Object.fromEntries(Object.entries(ent).filter(([k]) => k.toLowerCase() !== "department"));
    if (Object.keys(rest).length) extra[SCHEMA_ENTERPRISE_USER] = rest;
  }
  if (Array.isArray(emailsRaw)) extra.emails = emailsRaw;
  // Only keep name.formatted when it carries information beyond given + family name.
  if (formatted && formatted !== [givenName, familyName].filter(Boolean).join(" ")) extra.__nameFormatted = formatted;

  return {
    userName,
    externalId: str(getCI(body, "externalId"), "externalId"),
    givenName,
    familyName,
    displayName: str(getCI(body, "displayName"), "displayName") ?? formatted ?? ([givenName, familyName].filter(Boolean).join(" ") || null),
    email,
    title: str(getCI(body, "title"), "title"),
    department,
    active: bool(getCI(body, "active"), "active", true),
    extra,
    provisionedAppRoles: parseProvisionedAppRoles(body),
  };
}

export function toScimUser(u: UserRow, memberOf: { id: string; displayName: string }[], baseUrl: string): Json {
  const extra = { ...(u.scimAttributes ?? {}) } as Json;
  const formatted = (extra.__nameFormatted as string | undefined) ?? ([u.givenName, u.familyName].filter(Boolean).join(" ") || undefined);
  delete extra.__nameFormatted;
  const entExtra = isObj(extra[SCHEMA_ENTERPRISE_USER]) ? (extra[SCHEMA_ENTERPRISE_USER] as Json) : {};
  delete extra[SCHEMA_ENTERPRISE_USER];
  const emails = Array.isArray(extra.emails) ? extra.emails : u.email ? [{ value: u.email, type: "work", primary: true }] : undefined;
  delete extra.emails;

  const enterprise = { ...entExtra, ...(u.department ? { department: u.department } : {}) };
  const res: Json = {
    schemas: [SCHEMA_USER, ...(Object.keys(enterprise).length ? [SCHEMA_ENTERPRISE_USER] : [])],
    ...extra,
    id: u.id,
    ...(u.externalId ? { externalId: u.externalId } : {}),
    userName: u.userName,
    name: { ...(u.givenName ? { givenName: u.givenName } : {}), ...(u.familyName ? { familyName: u.familyName } : {}), ...(formatted ? { formatted } : {}) },
    ...(u.displayName ? { displayName: u.displayName } : {}),
    ...(emails ? { emails } : {}),
    active: u.active,
    ...(u.title ? { title: u.title } : {}),
    groups: memberOf.map((g) => ({ value: g.id, display: g.displayName, $ref: `${baseUrl}/Groups/${g.id}`, type: "direct" })),
    ...(Object.keys(enterprise).length ? { [SCHEMA_ENTERPRISE_USER]: enterprise } : {}),
    meta: {
      resourceType: "User",
      created: u.createdAt.toISOString(),
      lastModified: u.updatedAt.toISOString(),
      location: `${baseUrl}/Users/${u.id}`,
      version: `W/"${u.version}"`,
    },
  };
  return res;
}

/* ------------------------------------------------------------------ queries */

const liveScimUser = and(eq(users.provisioningSource, "scim"), isNull(users.deletedAt));

const USER_ATTRS: AttrMap = {
  id: { kind: "string", column: sql`${users.id}::text`, caseExact: false },
  username: { kind: "string", column: users.userName },
  externalid: { kind: "string", column: users.externalId, caseExact: true },
  displayname: { kind: "string", column: users.displayName },
  "name.givenname": { kind: "string", column: users.givenName },
  "name.familyname": { kind: "string", column: users.familyName },
  emails: { kind: "string", column: users.email },
  "emails.value": { kind: "string", column: users.email },
  title: { kind: "string", column: users.title },
  department: { kind: "string", column: users.department },
  [`${SCHEMA_ENTERPRISE_USER.toLowerCase()}:department`]: { kind: "string", column: users.department },
  active: { kind: "boolean", column: users.active },
  "meta.created": { kind: "date", column: users.createdAt },
  "meta.lastmodified": { kind: "date", column: users.updatedAt },
  "groups.value": {
    kind: "custom",
    build: (op, value) =>
      sql`exists (select 1 from group_memberships gm where gm.user_id = "users"."id" and ${stringCompare(sql`gm.group_id`, op, value)})`,
  },
};

async function groupsFor(tx: Tx | ReturnType<typeof getDb>, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { id: string; displayName: string }[]>();
  const rows = await tx
    .select({ userId: groupMemberships.userId, id: groups.id, displayName: groups.displayName })
    .from(groupMemberships)
    .innerJoin(groups, and(eq(groups.id, groupMemberships.groupId), isNull(groups.deletedAt)))
    .where(inArray(groupMemberships.userId, userIds));
  const map = new Map<string, { id: string; displayName: string }[]>();
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), { id: r.id, displayName: r.displayName }]);
  return map;
}

export async function listUsers(filter: string | null, startIndex: number, count: number, baseUrl: string) {
  const db = getDb();
  const conds: SQL[] = [liveScimUser!];
  if (filter) conds.push(filterToSql(parseFilter(filter), USER_ATTRS, SCHEMA_USER));
  const where = and(...conds);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
  const rows = count === 0 ? [] : await db.select().from(users).where(where).orderBy(users.createdAt, users.id).limit(count).offset(startIndex - 1);
  const g = await groupsFor(db, rows.map((r) => r.id));
  return {
    schemas: [SCHEMA_LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((r) => toScimUser(r, g.get(r.id) ?? [], baseUrl)),
  };
}

async function loadLive(tx: Tx | ReturnType<typeof getDb>, id: string, forUpdate = false): Promise<UserRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw ScimError.notFound(`User ${id} not found`);
  const q = tx.select().from(users).where(and(eq(users.id, id), liveScimUser));
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) throw ScimError.notFound(`User ${id} not found`);
  return row;
}

export async function getUser(id: string, baseUrl: string) {
  const db = getDb();
  const row = await loadLive(db, id);
  const g = await groupsFor(db, [row.id]);
  return toScimUser(row, g.get(row.id) ?? [], baseUrl);
}

async function assertUnique(tx: Tx, input: UserInput, excludeId?: string) {
  const conds = (c: SQL) => (excludeId ? and(c, isNull(users.deletedAt), ne(users.id, excludeId)) : and(c, isNull(users.deletedAt)));
  const [byName] = await tx.select({ id: users.id }).from(users).where(conds(sql`lower(${users.userName}) = lower(${input.userName})`));
  if (byName) throw ScimError.uniqueness(`userName '${input.userName}' is already in use`);
  if (input.externalId) {
    const [byExt] = await tx.select({ id: users.id }).from(users).where(conds(eq(users.externalId, input.externalId)));
    if (byExt) throw ScimError.uniqueness(`externalId '${input.externalId}' is already in use`);
  }
  // Email uniqueness: enforced so email-based OIDC matching resolves to a single account.
  if (input.email) {
    const [byEmail] = await tx.select({ id: users.id }).from(users).where(conds(sql`lower(${users.email}) = lower(${input.email})`));
    if (byEmail) throw ScimError.uniqueness(`email '${input.email}' is already in use`);
  }
}

function label(u: { displayName: string | null; userName: string }) {
  return u.displayName || u.userName;
}

/* ------------------------------------------------------------------ mutations */

export async function createUser(body: unknown, baseUrl: string, ip: string | null) {
  const input = parseUserInput(body);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"scim-user:" + input.userName.toLowerCase()}))`);
    await assertUnique(tx, input);
    const now = new Date();
    const [row] = await tx
      .insert(users)
      .values({
        userName: input.userName, externalId: input.externalId, givenName: input.givenName, familyName: input.familyName,
        displayName: input.displayName, email: input.email, title: input.title, department: input.department,
        active: input.active, provisioningSource: "scim", scimAttributes: input.extra,
        provisionedAppRoles: input.provisionedAppRoles, lastSyncedAt: now,
        deactivatedAt: input.active ? null : now,
      })
      .returning();
    await audit({
      category: "provisioning", action: "user.provisioned", ...SCIM_ACTOR, ipAddress: ip,
      targetType: "user", targetId: row.id, targetLabel: label(row),
      details: { userName: row.userName, externalId: row.externalId, email: row.email, department: row.department, title: row.title, active: row.active, appRoles: input.provisionedAppRoles.map((r) => r.value) },
    }, tx);
    // Derive entitlements from any application roles provisioned on creation.
    if (row.active && input.provisionedAppRoles.length) {
      await recomputeUserEntitlements(tx, row.id, SCIM_ACTOR, "application roles provisioned by Fixiam");
    }
    return toScimUser(row, [], baseUrl);
  });
}

const TRACKED: (keyof UserInput & keyof UserRow)[] = ["userName", "externalId", "givenName", "familyName", "displayName", "email", "title", "department", "active"];

/** Shared by PUT and PATCH: persist a full new representation and apply lifecycle side effects. */
async function persistReplacement(tx: Tx, current: UserRow, input: UserInput, baseUrl: string, ip: string | null, via: "PUT" | "PATCH") {
  await assertUnique(tx, input, current.id);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of TRACKED) if ((current[f] ?? null) !== (input[f] ?? null)) changes[f] = { from: current[f], to: input[f] };
  const extraChanged = JSON.stringify(current.scimAttributes ?? {}) !== JSON.stringify(input.extra);
  const appRolesChanged = appRolesSignature(current.provisionedAppRoles) !== appRolesSignature(input.provisionedAppRoles);
  const now = new Date();

  const [row] = await tx
    .update(users)
    .set({
      userName: input.userName, externalId: input.externalId, givenName: input.givenName, familyName: input.familyName,
      displayName: input.displayName, email: input.email, title: input.title, department: input.department,
      active: input.active, scimAttributes: input.extra, provisionedAppRoles: input.provisionedAppRoles, lastSyncedAt: now,
      ...(Object.keys(changes).length || extraChanged || appRolesChanged ? { updatedAt: now, version: sql`${users.version} + 1` } : {}),
      ...("active" in changes ? { deactivatedAt: input.active ? null : now } : {}),
    })
    .where(eq(users.id, current.id))
    .returning();

  const target = { targetType: "user", targetId: row.id, targetLabel: label(row) };
  const { active: activeChange, ...attrChanges } = changes;
  if (Object.keys(attrChanges).length || extraChanged) {
    await audit({ category: "provisioning", action: "user.updated", ...SCIM_ACTOR, ipAddress: ip, ...target, details: { via, changes: attrChanges, otherAttributesChanged: extraChanged } }, tx);
  }
  if (activeChange) {
    if (!input.active) {
      await audit({ category: "provisioning", action: "user.deactivated", ...SCIM_ACTOR, ipAddress: ip, ...target, details: { via, effect: "All CAPS access suspended; active sessions revoked" } }, tx);
      await revokeUserSessions(tx, row.id, "user_deactivated", SCIM_ACTOR, label(row));
    } else {
      await audit({ category: "provisioning", action: "user.reactivated", ...SCIM_ACTOR, ipAddress: ip, ...target, details: { via } }, tx);
    }
  }
  // Reconcile entitlements when provisioned application roles changed (add/replace/remove) or
  // the active state changed. Deactivation yields an empty desired set → all roles revoked
  // (in addition to session revocation above); reactivation restores them.
  if (appRolesChanged || "active" in changes) {
    const reason = "active" in changes
      ? (input.active ? "user reactivated by Fixiam" : "user deactivated by Fixiam")
      : "application roles changed by Fixiam";
    await recomputeUserEntitlements(tx, row.id, SCIM_ACTOR, reason);
  }
  const g = await groupsFor(tx, [row.id]);
  return toScimUser(row, g.get(row.id) ?? [], baseUrl);
}

export async function replaceUser(id: string, body: unknown, baseUrl: string, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const current = await loadLive(tx, id, true);
    if (isObj(body) && body.id !== undefined && body.id !== current.id) throw ScimError.mutability("'id' is immutable");
    return persistReplacement(tx, current, parseUserInput(body), baseUrl, ip, "PUT");
  });
}

export async function patchUser(id: string, body: unknown, baseUrl: string, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const current = await loadLive(tx, id, true);
    const g = await groupsFor(tx, [current.id]);
    const before = toScimUser(current, g.get(current.id) ?? [], baseUrl);
    const after = applyPatch(before, body, { multiValued: USER_MULTI_VALUED, coreSchemas: [SCHEMA_USER] });
    if (after.id !== current.id) throw ScimError.mutability("'id' is immutable");
    return persistReplacement(tx, current, parseUserInput(after), baseUrl, ip, "PATCH");
  });
}

/**
 * Deprovision (SCIM DELETE): the user is soft-deleted (kept for audit history),
 * all group memberships are removed, entitlements revoked and sessions revoked.
 */
export async function deleteUser(id: string, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const current = await loadLive(tx, id, true);
    const now = new Date();
    const memberships = await tx
      .select({ groupId: groupMemberships.groupId, name: groups.displayName })
      .from(groupMemberships)
      .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
      .where(eq(groupMemberships.userId, current.id));
    await tx.update(users).set({ deletedAt: now, active: false, deactivatedAt: current.deactivatedAt ?? now, updatedAt: now, lastSyncedAt: now }).where(eq(users.id, current.id));
    const target = { targetType: "user", targetId: current.id, targetLabel: label(current) };
    await audit({ category: "provisioning", action: "user.deprovisioned", ...SCIM_ACTOR, ipAddress: ip, ...target, details: { userName: current.userName, removedFromGroups: memberships.map((m) => m.name), effect: "Application access withdrawn" } }, tx);
    if (memberships.length) {
      await tx.delete(groupMemberships).where(eq(groupMemberships.userId, current.id));
      for (const m of memberships) {
        await audit({ category: "group", action: "group.member_removed", ...SCIM_ACTOR, ipAddress: ip, ...target, details: { group: m.name, groupId: m.groupId, reason: "user deprovisioned" } }, tx);
      }
    }
    await recomputeUserEntitlements(tx, current.id, SCIM_ACTOR, "user deprovisioned by Fixiam");
    await revokeUserSessions(tx, current.id, "user_deprovisioned", SCIM_ACTOR, label(current));
    return { id: current.id, label: label(current) };
  });
}
