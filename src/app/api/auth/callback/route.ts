import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { oidcTransactions } from "@/lib/db/schema";
import { completeLogin } from "@/lib/auth/oidc";
import { linkIdentity } from "@/lib/auth/link";
import { clearCookie, createSession, OIDC_TXN_COOKIE, SESSION_COOKIE, cookieOptions, hashToken } from "@/lib/auth/session";
import { audit, auditSafe } from "@/lib/audit/log";
import { clientIp } from "@/lib/authz/principal";
import { getOidcEnv, getOidcMatchStrategy } from "@/lib/env";

export const dynamic = "force-dynamic";

function fail(req: NextRequest, reason: string) {
  const res = NextResponse.redirect(new URL(`/login?reason=${reason}`, req.url), 302);
  clearCookie(res, OIDC_TXN_COOKIE);
  return res;
}

/** Fixiam redirects here with ?code&state after authentication. */
export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers);
  const anon = { actorType: "anonymous" as const, actorLabel: "Unauthenticated user", ipAddress: ip };

  // 1. Load and consume the login transaction bound to this browser (single use).
  const binding = req.cookies.get(OIDC_TXN_COOKIE)?.value;
  const db = getDb();
  const [txn] = binding
    ? await db.delete(oidcTransactions).where(eq(oidcTransactions.bindingHash, hashToken(binding))).returning()
    : [];

  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    await auditSafe({ category: "authentication", action: "authentication.login_failed", outcome: "failure", ...anon, details: { stage: "authorization_response", error, error_description: req.nextUrl.searchParams.get("error_description")?.slice(0, 300) } });
    return fail(req, error === "access_denied" ? "access_denied" : "login_failed");
  }
  if (!txn || txn.expiresAt < new Date()) {
    await auditSafe({ category: "authentication", action: "authentication.login_failed", outcome: "failure", ...anon, details: { stage: "state_validation", error: txn ? "login_transaction_expired" : "missing_or_unknown_login_transaction" } });
    return fail(req, "login_failed");
  }

  // 2. Code exchange + ID token validation (signature, iss, aud, exp, nonce, state, PKCE).
  let result;
  try {
    // Rebuild the callback URL on the registered redirect URI so proxies cannot alter it.
    const callbackUrl = new URL(getOidcEnv().FIXIAM_REDIRECT_URI);
    callbackUrl.search = req.nextUrl.search;
    result = await completeLogin(callbackUrl, txn);
  } catch (e) {
    await auditSafe({ category: "authentication", action: "authentication.login_failed", outcome: "failure", ...anon, details: { stage: "token_validation", error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "unknown" } });
    return fail(req, "login_failed");
  }
  const { identity, idToken } = result;
  const who = identity.name || identity.preferredUsername || identity.email || identity.sub;

  // 3. Map to the SCIM-provisioned CAPS account using the configured strategy.
  const strategy = getOidcMatchStrategy();
  const link = await linkIdentity(identity, ip, strategy);
  if (!link.ok) {
    await auditSafe({
      category: "authentication", action: "authentication.login_denied", outcome: "denied", actorType: "fixiam_oidc", actorLabel: who, ipAddress: ip,
      targetType: link.userId ? "user" : null, targetId: link.userId ?? null, targetLabel: link.label ?? who,
      details: { reason: link.reason, strategy, sub: identity.sub, email: identity.email ?? null, email_verified: identity.emailVerified ?? null, preferred_username: identity.preferredUsername ?? null },
    });
    const reasonParam =
      link.reason === "account_inactive" ? "account_inactive"
      : link.reason === "email_unverified" ? "email_unverified"
      : link.reason === "not_provisioned" ? "not_provisioned"
      : "login_failed"; // identity_conflict, ambiguous_email
    return fail(req, reasonParam);
  }

  // 4. Establish the CAPS session.
  const session = await createSession({ userId: link.userId, idToken, authTime: identity.authTime ?? null, ipAddress: ip, userAgent: req.headers.get("user-agent") });
  await audit({
    category: "authentication", action: "authentication.login_succeeded", actorType: "user", actorUserId: link.userId, actorLabel: link.label, ipAddress: ip,
    targetType: "user", targetId: link.userId, targetLabel: link.label,
    details: {
      method: "Fixiam OIDC (authorization code + PKCE)", matchedOn: link.matchedOn, firstSignIn: link.linkedNow, claimsReceived: identity.claimNames,
      groupsClaim: identity.groups ?? null, roleClaim: identity.role ?? null,
      note: "CAPS roles are derived from Fixiam group membership synchronised over SCIM",
    },
  });
  const res = NextResponse.redirect(new URL(txn.returnTo || "/dashboard", req.url), 302);
  clearCookie(res, OIDC_TXN_COOKIE);
  res.cookies.set(SESSION_COOKIE, session.token, cookieOptions(session.maxAgeSeconds));
  return res;
}
