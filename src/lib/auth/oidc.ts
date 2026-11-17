import "server-only";
import * as client from "openid-client";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getOidcEnv } from "@/lib/env";

/**
 * Fixiam OpenID Connect client (Authorization Code Flow + PKCE).
 *
 * All endpoints are taken from Fixiam's discovery document at
 * <FIXIAM_ISSUER_URL>/.well-known/openid-configuration — none are hard-coded.
 * Runs exclusively on the server; the client secret never reaches the browser.
 */

let cached: { config: client.Configuration; at: number; key: string } | null = null;
const TTL_MS = 60 * 60 * 1000;

function isLocalHttp(u: string) {
  const url = new URL(u);
  return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
}

export async function getOidcConfig(): Promise<client.Configuration> {
  const env = getOidcEnv();
  const key = `${env.FIXIAM_ISSUER_URL}|${env.FIXIAM_CLIENT_ID}|${env.FIXIAM_TOKEN_AUTH_METHOD}`;
  if (cached && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.config;

  const auth = env.FIXIAM_TOKEN_AUTH_METHOD === "client_secret_post"
    ? client.ClientSecretPost(env.FIXIAM_CLIENT_SECRET)
    : client.ClientSecretBasic(env.FIXIAM_CLIENT_SECRET);

  // Plain HTTP is accepted only for a localhost test IdP, and only with an explicit opt-in flag.
  const insecureOk = process.env.OIDC_ALLOW_INSECURE_LOCALHOST === "true" && isLocalHttp(env.FIXIAM_ISSUER_URL);
  const config = await client.discovery(
    new URL(env.FIXIAM_ISSUER_URL),
    env.FIXIAM_CLIENT_ID,
    { client_secret: env.FIXIAM_CLIENT_SECRET },
    auth,
    insecureOk ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  // Validate ID Token JWS signatures against the issuer's JWKS (openid-client skips this by default for TLS-delivered tokens).
  client.enableNonRepudiationChecks(config);
  cached = { config, at: Date.now(), key };
  return config;
}

export function resetOidcCache() {
  cached = null;
}

export async function beginLogin() {
  const env = getOidcEnv();
  const config = await getOidcConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: env.FIXIAM_REDIRECT_URI,
    scope: env.FIXIAM_SCOPES,
    response_type: "code",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return { url, state, nonce, codeVerifier };
}

export interface FixiamIdentity {
  sub: string;
  email?: string;
  /** OIDC `email_verified` claim: true only when the IdP asserts the email is verified. */
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  preferredUsername?: string;
  groups?: string[];
  role?: string | string[];
  claimNames: string[];
  authTime?: Date;
}

function asString(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Parse an OIDC boolean-ish claim (true | "true" | 1). Anything else (incl. absent) is undefined. */
function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return undefined;
}

export function mapClaims(claims: JWTPayload & Record<string, unknown>, userinfo?: Record<string, unknown>): FixiamIdentity {
  const c = { ...(userinfo ?? {}), ...claims } as Record<string, unknown>;
  const groups = Array.isArray(c.groups) ? c.groups.filter((g): g is string => typeof g === "string") : undefined;
  const role = Array.isArray(c.role) ? c.role.filter((r): r is string => typeof r === "string") : asString(c.role);
  return {
    sub: String(claims.sub),
    email: asString(c.email),
    emailVerified: asBool(c.email_verified),
    name: asString(c.name),
    givenName: asString(c.given_name),
    familyName: asString(c.family_name),
    preferredUsername: asString(c.preferred_username),
    groups,
    role,
    claimNames: Object.keys(c).sort(),
    authTime: typeof c.auth_time === "number" ? new Date(c.auth_time * 1000) : undefined,
  };
}

/**
 * Exchange the authorization code (server-to-server, with PKCE verifier) and
 * validate the ID Token: signature (JWKS), issuer, audience, expiry, nonce.
 */
export async function completeLogin(callbackUrl: URL, txn: { state: string; nonce: string; codeVerifier: string }) {
  const env = getOidcEnv();
  const config = await getOidcConfig();
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: txn.codeVerifier,
    expectedState: txn.state,
    expectedNonce: txn.nonce,
    idTokenExpected: true,
  });
  if (!tokens.id_token) throw new Error("Fixiam did not return an ID token");

  // Explicit, independent verification of the ID Token (defence in depth).
  const meta = config.serverMetadata();
  if (!meta.jwks_uri) throw new Error("Fixiam discovery document does not advertise jwks_uri");
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: meta.issuer,
    audience: env.FIXIAM_CLIENT_ID,
    clockTolerance: 60,
    requiredClaims: ["sub", "iat", "exp"],
  });
  if (payload.nonce !== txn.nonce) throw new Error("ID token nonce mismatch");

  let userinfo: Record<string, unknown> | undefined;
  const claims = tokens.claims() as JWTPayload & Record<string, unknown>;
  if (meta.userinfo_endpoint && tokens.access_token && (!claims.email || !claims.preferred_username)) {
    try {
      userinfo = (await client.fetchUserInfo(config, tokens.access_token, String(claims.sub))) as Record<string, unknown>;
    } catch {
      userinfo = undefined; // optional enrichment only
    }
  }
  return { identity: mapClaims(claims, userinfo), idToken: tokens.id_token };
}

export async function buildLogoutUrl(idToken: string | null) {
  const env = getOidcEnv();
  const config = await getOidcConfig();
  if (!config.serverMetadata().end_session_endpoint) return null;
  return client.buildEndSessionUrl(config, {
    post_logout_redirect_uri: env.FIXIAM_POST_LOGOUT_REDIRECT_URI,
    client_id: env.FIXIAM_CLIENT_ID,
    ...(idToken ? { id_token_hint: idToken } : {}),
  });
}

/** Non-secret summary of the discovery document for the Integration Settings page. */
export async function describeDiscovery() {
  resetOidcCache();
  const config = await getOidcConfig();
  const m = config.serverMetadata();
  return {
    issuer: m.issuer,
    endpoints: {
      authorization_endpoint: m.authorization_endpoint,
      token_endpoint: m.token_endpoint,
      userinfo_endpoint: m.userinfo_endpoint,
      jwks_uri: m.jwks_uri,
      end_session_endpoint: m.end_session_endpoint,
    },
    supports: {
      code_challenge_methods_supported: m.code_challenge_methods_supported ?? null,
      token_endpoint_auth_methods_supported: m.token_endpoint_auth_methods_supported ?? null,
      id_token_signing_alg_values_supported: m.id_token_signing_alg_values_supported ?? null,
      scopes_supported: m.scopes_supported ?? null,
      claims_supported: m.claims_supported ?? null,
      backchannel_logout_supported: m.backchannel_logout_supported ?? null,
    },
  };
}
