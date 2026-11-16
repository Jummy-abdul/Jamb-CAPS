import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { applicationRoles, groupMemberships, groups, roleMappings } from "@/lib/db/schema";
import { audit } from "@/lib/audit/log";
import { recomputeAllEntitlements } from "./entitlements";
import type { Principal } from "./principal";

export class MappingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type SourceType = "group_display_name" | "group_external_id";

/** Is the acting administrator a member of any group this mapping would match? */
async function affectsActor(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], actorId: string, sourceType: SourceType, sourceValue: string) {
  const match =
    sourceType === "group_display_name"
      ? sql`lower(${groups.displayName}) = lower(${sourceValue})`
      : eq(groups.externalId, sourceValue);
  const rows = await tx
    .select({ id: groups.id })
    .from(groupMemberships)
    .innerJoin(groups, and(eq(groups.id, groupMemberships.groupId), isNull(groups.deletedAt)))
    .where(and(eq(groupMemberships.userId, actorId), match));
  return rows.length > 0;
}

async function countAffected(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) {
  const [{ n }] = await tx.select({ n: sql<number>`count(distinct user_id)::int` }).from(groupMemberships);
  return n;
}

export async function createMapping(p: Principal, input: { sourceType: SourceType; sourceValue: string; roleKey: string; description?: string }, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const [role] = await tx.select().from(applicationRoles).where(eq(applicationRoles.key, input.roleKey));
    if (!role) throw new MappingError(400, "Unknown CAPS role.");
    const actor = { actorType: "user" as const, actorUserId: p.user.id, actorLabel: p.user.displayName, ipAddress: ip };
    if (await affectsActor(tx, p.user.id, input.sourceType, input.sourceValue)) {
      await audit({ category: "configuration", action: "role_mapping.change_blocked", outcome: "denied", ...actor, targetType: "role_mapping", targetLabel: `${input.sourceValue} → ${role.name}`, details: { reason: "self_escalation_prevented" } });
      throw new MappingError(403, "You are a member of a group this mapping matches. Mappings that change your own access must be made by another administrator.");
    }
    const existing = await tx
      .select({ id: roleMappings.id })
      .from(roleMappings)
      .where(and(eq(roleMappings.sourceType, input.sourceType), sql`lower(${roleMappings.sourceValue}) = lower(${input.sourceValue})`, eq(roleMappings.roleKey, input.roleKey)));
    if (existing.length) throw new MappingError(409, "An identical mapping already exists.");
    const [m] = await tx
      .insert(roleMappings)
      .values({ sourceType: input.sourceType, sourceValue: input.sourceValue, roleKey: input.roleKey, description: input.description || null, createdBy: p.user.displayName })
      .returning();
    await audit({ category: "configuration", action: "role_mapping.created", ...actor, targetType: "role_mapping", targetId: m.id, targetLabel: `${m.sourceValue} → ${role.name}`, details: { sourceType: m.sourceType, roleKey: m.roleKey } }, tx);
    await recomputeAllEntitlements(tx, { actorType: "user", actorUserId: p.user.id, actorLabel: p.user.displayName }, "role mapping created");
    return { mapping: m, recomputedUsers: await countAffected(tx) };
  });
}

export async function setMappingEnabled(p: Principal, id: string, enabled: boolean, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const [m] = await tx.select({ m: roleMappings, roleName: applicationRoles.name }).from(roleMappings).innerJoin(applicationRoles, eq(applicationRoles.key, roleMappings.roleKey)).where(eq(roleMappings.id, id));
    if (!m) throw new MappingError(404, "Mapping not found.");
    const actor = { actorType: "user" as const, actorUserId: p.user.id, actorLabel: p.user.displayName, ipAddress: ip };
    const label = `${m.m.sourceValue} → ${m.roleName}`;
    if (await affectsActor(tx, p.user.id, m.m.sourceType, m.m.sourceValue)) {
      await audit({ category: "configuration", action: "role_mapping.change_blocked", outcome: "denied", ...actor, targetType: "role_mapping", targetId: id, targetLabel: label, details: { reason: "self_modification_prevented", requestedEnabled: enabled } });
      throw new MappingError(403, "This mapping applies to a group you belong to. Changes that affect your own access must be made by another administrator.");
    }
    if (m.m.enabled === enabled) return { mapping: m.m, recomputedUsers: 0 };
    const [updated] = await tx.update(roleMappings).set({ enabled, updatedAt: new Date() }).where(eq(roleMappings.id, id)).returning();
    await audit({ category: "configuration", action: enabled ? "role_mapping.enabled" : "role_mapping.disabled", ...actor, targetType: "role_mapping", targetId: id, targetLabel: label }, tx);
    await recomputeAllEntitlements(tx, { actorType: "user", actorUserId: p.user.id, actorLabel: p.user.displayName }, enabled ? "role mapping enabled" : "role mapping disabled");
    return { mapping: updated, recomputedUsers: await countAffected(tx) };
  });
}
