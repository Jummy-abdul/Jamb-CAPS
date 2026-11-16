import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { userSessions } from "@/lib/db/schema";
import { buildLogoutUrl } from "@/lib/auth/oidc";
import { SESSION_COOKIE, clearCookie, hashToken, revokeSessionById } from "@/lib/auth/session";
import { auditSafe } from "@/lib/audit/log";
import { clientIp, resolvePrincipalFromToken } from "@/lib/authz/principal";

export const dynamic = "force-dynamic";

/** Sign out: revoke the CAPS session, then RP-initiated logout at Fixiam when supported. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let redirectTo: URL = new URL("/login?reason=logged_out", req.url);
  if (token) {
    const [row] = await getDb().select({ id: userSessions.id, idToken: userSessions.idToken }).from(userSessions).where(eq(userSessions.tokenHash, hashToken(token)));
    const p = await resolvePrincipalFromToken(token);
    if (row) {
      await revokeSessionById(row.id, "logout");
      if (p.ok) {
        await auditSafe({ category: "authentication", action: "authentication.logout", actorType: "user", actorUserId: p.principal.user.id, actorLabel: p.principal.user.displayName, targetType: "user", targetId: p.principal.user.id, targetLabel: p.principal.user.displayName, ipAddress: clientIp(req.headers) });
      }
      try {
        const fixiamLogout = await buildLogoutUrl(row.idToken);
        if (fixiamLogout) redirectTo = fixiamLogout;
      } catch {
        // Fixiam unreachable or not configured: local sign-out still completed.
      }
    }
  }
  const res = NextResponse.redirect(redirectTo, 303);
  clearCookie(res, SESSION_COOKIE);
  return res;
}
