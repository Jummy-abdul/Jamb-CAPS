import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { oidcTransactions } from "@/lib/db/schema";
import { beginLogin } from "@/lib/auth/oidc";
import { OIDC_TXN_COOKIE, cookieOptions, hashToken, newOpaqueToken } from "@/lib/auth/session";
import { auditSafe } from "@/lib/audit/log";
import { clientIp } from "@/lib/authz/principal";
import { ConfigError } from "@/lib/env";
import { lt } from "drizzle-orm";

export const dynamic = "force-dynamic";

const TXN_TTL_SECONDS = 600;

/** Start the Fixiam Authorization Code + PKCE flow. */
export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get("returnTo");
  const safeReturn = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard";
  try {
    const { url, state, nonce, codeVerifier } = await beginLogin();
    // Bind the login transaction to this browser with a random, HttpOnly cookie.
    const binding = newOpaqueToken();
    const db = getDb();
    await db.delete(oidcTransactions).where(lt(oidcTransactions.expiresAt, new Date()));
    await db.insert(oidcTransactions).values({
      bindingHash: hashToken(binding), state, nonce, codeVerifier, returnTo: safeReturn,
      expiresAt: new Date(Date.now() + TXN_TTL_SECONDS * 1000),
    });
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(OIDC_TXN_COOKIE, binding, cookieOptions(TXN_TTL_SECONDS));
    return res;
  } catch (e) {
    const notConfigured = e instanceof ConfigError;
    await auditSafe({
      category: "authentication", action: "authentication.login_failed", outcome: "failure", actorType: "anonymous",
      actorLabel: "Unauthenticated user", ipAddress: clientIp(req.headers),
      details: { stage: "authorization_request", error: notConfigured ? "oidc_not_configured" : e instanceof Error ? e.message.slice(0, 300) : "unknown" },
    });
    return NextResponse.redirect(new URL(`/login?reason=${notConfigured ? "not_configured" : "login_failed"}`, req.url), 302);
  }
}
