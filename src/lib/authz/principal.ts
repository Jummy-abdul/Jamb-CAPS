import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { applicationRoles, rolePermissions, userEntitlements, userSessions, users } from "@/lib/db/schema";
import { getSessionEnv } from "@/lib/env";
import { SESSION_COOKIE, hashToken } from "@/lib/auth/session";
import { audit, auditSafe } from "@/lib/audit/log";
import { isPermission, type Permission } from "./permissions";

/**
 * Central authorization service.
 *
 * `resolvePrincipal` is the single place where an incoming request is turned
 * into an authenticated principal with effective permissions. It is evaluated on
 * every request (no caching across requests), and denies by default.
 */

export interface Principal {
  sessionId: string;
  user: {
    id: string;
    userName: string;
    displayName: string;
    email: string | null;
    title: string | null;
    department: string | null;
  };
  roles: { key: string; name: string; viaGroups: string[] }[];
  permissions: Set<Permission>;
}

export type SessionFailure =
  | "no_session"
  | "invalid_session"
  | "session_revoked"
  | "session_expired"
  | "idle_timeout"
  | "account_inactive"
  | "account_deprovisioned"
  | "not_configured";

export type PrincipalResult = { ok: true; principal: Principal } | { ok: false; reason: SessionFailure };

export function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function resolvePrincipalFromToken(token: string | undefined | null): Promise<PrincipalResult> {
  if (!token) return { ok: false, reason: "no_session" };
  let env;
  try {
    env = getSessionEnv();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  const db = getDb();
  const [row] = await db
    .select({ session: userSessions, user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.tokenHash, hashToken(token)));
  if (!row) return { ok: false, reason: "invalid_session" };

  const { session, user } = row;
  const now = Date.now();
  if (session.revokedAt) {
    // Tell the user *why* the session ended when Fixiam withdrew access.
    if (session.revokeReason === "user_deactivated") return { ok: false, reason: "account_inactive" };
    if (session.revokeReason === "user_deprovisioned") return { ok: false, reason: "account_deprovisioned" };
    return { ok: false, reason: "session_revoked" };
  }
  if (session.expiresAt.getTime() <= now) return { ok: false, reason: "session_expired" };
  if (session.lastSeenAt.getTime() + env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000 <= now) {
    await db.update(userSessions).set({ revokedAt: new Date(), revokeReason: "idle_timeout" }).where(eq(userSessions.id, session.id));
    return { ok: false, reason: "idle_timeout" };
  }

  // Account state is re-checked on every request: Fixiam deactivation/deprovisioning takes effect immediately.
  if (user.deletedAt || user.provisioningSource !== "scim" || !user.active) {
    const reason: SessionFailure = user.deletedAt ? "account_deprovisioned" : "account_inactive";
    await db.update(userSessions).set({ revokedAt: new Date(), revokeReason: reason }).where(eq(userSessions.id, session.id));
    await auditSafe({
      category: "session",
      action: "session.rejected",
      outcome: "denied",
      actorType: "system",
      actorLabel: "CAPS session validation",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.displayName || user.userName,
      details: { reason },
    });
    return { ok: false, reason };
  }

  // Effective roles and permissions from active, Fixiam-derived entitlements.
  const grants = await db
    .select({ roleKey: userEntitlements.roleKey, roleName: applicationRoles.name, group: userEntitlements.sourceGroupName })
    .from(userEntitlements)
    .innerJoin(applicationRoles, eq(applicationRoles.key, userEntitlements.roleKey))
    .where(and(eq(userEntitlements.userId, user.id), isNull(userEntitlements.revokedAt)));

  const roleMap = new Map<string, { key: string; name: string; viaGroups: string[] }>();
  for (const g of grants) {
    const r = roleMap.get(g.roleKey) ?? { key: g.roleKey, name: g.roleName, viaGroups: [] };
    if (g.group) r.viaGroups.push(g.group);
    roleMap.set(g.roleKey, r);
  }

  const perms = new Set<Permission>();
  if (roleMap.size > 0) {
    const rows = await db
      .selectDistinct({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(sql`${rolePermissions.roleKey} in (${sql.join([...roleMap.keys()].map((k) => sql`${k}`), sql`, `)})`);
    for (const r of rows) if (isPermission(r.key)) perms.add(r.key);
  }

  // Sliding idle window (throttled to one write per minute).
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, session.id));
  }

  return {
    ok: true,
    principal: {
      sessionId: session.id,
      user: {
        id: user.id,
        userName: user.userName,
        displayName: user.displayName || [user.givenName, user.familyName].filter(Boolean).join(" ") || user.userName,
        email: user.email,
        title: user.title,
        department: user.department,
      },
      roles: [...roleMap.values()],
      permissions: perms,
    },
  };
}

/** Resolve the principal for the current request (deduplicated within one render). */
export const getPrincipalResult = cache(async (): Promise<PrincipalResult> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolvePrincipalFromToken(token);
});

export function can(principal: Principal, permission: Permission) {
  return principal.permissions.has(permission);
}

/** For server-rendered pages: require a session (and optionally a permission). */
export async function requirePage(permission?: Permission, resource?: string): Promise<Principal> {
  const result = await getPrincipalResult();
  if (!result.ok) redirect(`/login?reason=${result.reason}`);
  const principal = result.principal;
  if (permission && !can(principal, permission)) {
    const h = await headers();
    await audit({
      category: "authorization",
      action: "access.denied",
      outcome: "denied",
      actorType: "user",
      actorUserId: principal.user.id,
      actorLabel: principal.user.displayName,
      targetType: "page",
      targetId: resource ?? null,
      targetLabel: resource ?? null,
      details: { requiredPermission: permission, effectiveRoles: principal.roles.map((r) => r.key) },
      ipAddress: clientIp(h),
    });
    redirect(`/access-denied?permission=${encodeURIComponent(permission)}`);
  }
  return principal;
}

export type ApiAuth = { ok: true; principal: Principal } | { ok: false; response: Response };

/**
 * For route handlers: authenticate, enforce same-origin for state-changing
 * requests, and require a permission. Denials are audited.
 */
export async function requireApi(req: Request, permission: Permission, resource: string): Promise<ApiAuth> {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || !host || new URL(origin).host !== host) {
      return { ok: false, response: Response.json({ error: "Cross-origin request rejected" }, { status: 403 }) };
    }
  }
  const result = await getPrincipalResult();
  if (!result.ok) {
    return { ok: false, response: Response.json({ error: "Authentication required", reason: result.reason }, { status: 401 }) };
  }
  const principal = result.principal;
  if (!can(principal, permission)) {
    await audit({
      category: "authorization",
      action: "access.denied",
      outcome: "denied",
      actorType: "user",
      actorUserId: principal.user.id,
      actorLabel: principal.user.displayName,
      targetType: "api",
      targetId: resource,
      targetLabel: `${req.method} ${resource}`,
      details: { requiredPermission: permission, effectiveRoles: principal.roles.map((r) => r.key) },
      ipAddress: clientIp(req.headers),
    });
    return {
      ok: false,
      response: Response.json(
        { error: "You do not have permission to perform this action.", requiredPermission: permission },
        { status: 403 },
      ),
    };
  }
  return { ok: true, principal };
}
