import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type Tx } from "@/lib/db/client";
import { userSessions } from "@/lib/db/schema";
import { getSessionEnv } from "@/lib/env";
import { audit, type AuditEntry } from "@/lib/audit/log";

/**
 * Opaque server-side sessions.
 *
 * The browser holds only a random 256-bit token in an HttpOnly cookie; the
 * database stores an HMAC of it. Every request re-reads the session row and the
 * user's account state, so revocation is immediate.
 */

const isProd = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = isProd ? "__Host-caps_session" : "caps_session";
export const OIDC_TXN_COOKIE = isProd ? "__Host-caps_oidc_txn" : "caps_oidc_txn";

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  const { SESSION_SECRET } = getSessionEnv();
  return createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
}

export async function createSession(input: {
  userId: string;
  idToken?: string | null;
  authTime?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const { SESSION_MAX_AGE_MINUTES } = getSessionEnv();
  const token = newOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MINUTES * 60_000);
  const [row] = await getDb()
    .insert(userSessions)
    .values({
      tokenHash: hashToken(token),
      userId: input.userId,
      idToken: input.idToken ?? null,
      authTime: input.authTime ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      expiresAt,
    })
    .returning({ id: userSessions.id });
  return { token, sessionId: row.id, maxAgeSeconds: SESSION_MAX_AGE_MINUTES * 60 };
}

/** Revoke all live sessions of a user (deactivation, deprovisioning). Audited. */
export async function revokeUserSessions(
  tx: Tx,
  userId: string,
  reason: string,
  actor: Pick<AuditEntry, "actorType" | "actorLabel" | "actorUserId">,
  targetLabel?: string,
) {
  const revoked = await tx
    .update(userSessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  if (revoked.length > 0) {
    await audit(
      {
        category: "session",
        action: "session.revoked",
        ...actor,
        targetType: "user",
        targetId: userId,
        targetLabel: targetLabel ?? null,
        details: { reason, sessionsRevoked: revoked.length },
      },
      tx,
    );
  }
  return revoked.length;
}

export async function revokeSessionById(sessionId: string, reason: string) {
  await getDb()
    .update(userSessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
}

/** Clear a cookie with the same attributes it was set with (required for __Host- cookies). */
export function clearCookie(res: { cookies: { set: (name: string, value: string, opts: ReturnType<typeof cookieOptions>) => unknown } }, name: string) {
  res.cookies.set(name, "", cookieOptions(0));
}
