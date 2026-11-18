import "server-only";
import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * Validation is split per integration (database, session, OIDC, SCIM) and runs
 * lazily, so the application can be built and deployed before every Fixiam
 * credential is available. A feature whose configuration is missing fails
 * closed with a clear, non-secret error message.
 *
 * Nothing in this module may be imported by client components. Secrets are
 * never prefixed with NEXT_PUBLIC_ and therefore never reach browser bundles.
 */

export class ConfigError extends Error {
  constructor(
    public readonly area: string,
    public readonly missing: string[],
  ) {
    super(`${area} is not configured. Missing or invalid: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

const nonEmpty = z.string().trim().min(1);
const url = z.string().trim().url();

function parse<T extends z.ZodTypeAny>(area: string, schema: T, input: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join("."));
    throw new ConfigError(area, [...new Set(missing)]);
  }
  return result.data;
}

// ---------------------------------------------------------------- database
const dbSchema = z.object({ DATABASE_URL: nonEmpty });
export function getDbEnv() {
  return parse("Database", dbSchema, { DATABASE_URL: process.env.DATABASE_URL });
}

// ---------------------------------------------------------------- session
const sessionSchema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(480),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(60),
});
export function getSessionEnv() {
  return parse("Session", sessionSchema, {
    SESSION_SECRET: process.env.SESSION_SECRET,
    SESSION_MAX_AGE_MINUTES: process.env.SESSION_MAX_AGE_MINUTES || undefined,
    SESSION_IDLE_TIMEOUT_MINUTES: process.env.SESSION_IDLE_TIMEOUT_MINUTES || undefined,
  });
}

// ---------------------------------------------------------------- Fixiam OIDC
const oidcSchema = z.object({
  FIXIAM_ISSUER_URL: url,
  FIXIAM_CLIENT_ID: nonEmpty,
  FIXIAM_CLIENT_SECRET: nonEmpty,
  FIXIAM_REDIRECT_URI: url,
  FIXIAM_POST_LOGOUT_REDIRECT_URI: url,
  FIXIAM_SCOPES: nonEmpty.default("openid profile email"),
  /** client_secret_basic | client_secret_post — must match the Fixiam client registration. */
  FIXIAM_TOKEN_AUTH_METHOD: z.enum(["client_secret_basic", "client_secret_post"]).default("client_secret_basic"),
});
export type OidcEnv = z.infer<typeof oidcSchema>;
/**
 * How CAPS links an authenticated Fixiam identity to the SCIM-provisioned account.
 *   - "subject" (default, recommended): match Fixiam's stable, immutable subject
 *     (SCIM externalId == OIDC sub), then userName, then verified email.
 *   - "email": TEMPORARY demo strategy — match primarily on the verified OIDC email
 *     claim. Use while Fixiam's subject is configured to be the user's email and no
 *     immutable identifier is yet available. Migrate back to "subject" once Fixiam
 *     exposes an immutable user ID. Email-based linking always requires email_verified.
 */
export type OidcMatchStrategy = "subject" | "email";
export function getOidcMatchStrategy(): OidcMatchStrategy {
  const v = (process.env.CAPS_OIDC_MATCH_STRATEGY || "subject").trim().toLowerCase();
  return v === "email" ? "email" : "subject";
}

/**
 * Issuer explicitly designated as a trusted verified-email provider.
 *
 * TEMPORARY, provider-specific trust: when Fixiam omits `email_verified`, CAPS may treat the
 * email claim as verified ONLY for a token whose validated `iss` exactly equals this value.
 * This relies on Fixiam Engineering's guarantee that its email claims represent verified
 * addresses. It is unset by default (feature off), is compared to the cryptographically
 * validated token issuer (never applied globally), and never overrides an explicit
 * `email_verified: false`. Remove it once Fixiam emits `email_verified`, or once CAPS has
 * migrated to matching on Fixiam's immutable user ID.
 *
 * OIDC issuer identifiers are compared exactly (RFC 8414 / OpenID Connect Core §2); only
 * surrounding whitespace is trimmed.
 */
export function getOidcAssuredEmailIssuer(): string | undefined {
  const v = process.env.CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER?.trim();
  return v ? v : undefined;
}

/**
 * TEMPORARY, DEMO-ONLY exception to the verified-email gate.
 *
 * Purpose: let a small, explicitly named set of SCIM-provisioned demo users complete
 * account linking even though Fixiam currently sends `email_verified: false`. It is NOT a
 * general verification policy: it is consulted only at the email-match gate in linkIdentity,
 * never changes the `email_verified` claim, and never represents an email as verified.
 *
 * Safety properties (all must hold for the exception to apply — otherwise it is inert):
 *   - Disabled unless CAPS_DEMO_ALLOW_UNVERIFIED_EMAIL is exactly "true" (default: off).
 *   - CAPS_DEMO_UNVERIFIED_EMAIL_ALLOWLIST is an explicit list of full email addresses.
 *     Blank entries, wildcards ("*") and anything that is not a local-part@domain.tld are
 *     dropped, so a bare domain or "@domain" can never widen it. Empty ⇒ inert.
 *   - CAPS_DEMO_UNVERIFIED_EMAIL_ISSUER must be set and is later required to exactly equal the
 *     cryptographically validated token issuer.
 *
 * Removal: delete these three environment variables (or set the flag to anything but "true").
 * No code path references them elsewhere, so removal fully retires the exception.
 */
export interface DemoEmailOverride {
  enabled: boolean;
  allowlist: Set<string>;
  issuer: string | undefined;
}
export function getDemoEmailOverride(): DemoEmailOverride {
  const enabled = process.env.CAPS_DEMO_ALLOW_UNVERIFIED_EMAIL?.trim().toLowerCase() === "true";
  const allowlist = new Set(
    (process.env.CAPS_DEMO_UNVERIFIED_EMAIL_ALLOWLIST ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0 && !e.includes("*") && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
  );
  const issuer = process.env.CAPS_DEMO_UNVERIFIED_EMAIL_ISSUER?.trim() || undefined;
  return { enabled, allowlist, issuer };
}

export function getOidcEnv(): OidcEnv {
  return parse("Fixiam OIDC", oidcSchema, {
    FIXIAM_ISSUER_URL: process.env.FIXIAM_ISSUER_URL,
    FIXIAM_CLIENT_ID: process.env.FIXIAM_CLIENT_ID,
    FIXIAM_CLIENT_SECRET: process.env.FIXIAM_CLIENT_SECRET,
    FIXIAM_REDIRECT_URI: process.env.FIXIAM_REDIRECT_URI,
    FIXIAM_POST_LOGOUT_REDIRECT_URI: process.env.FIXIAM_POST_LOGOUT_REDIRECT_URI,
    FIXIAM_SCOPES: process.env.FIXIAM_SCOPES || undefined,
    FIXIAM_TOKEN_AUTH_METHOD: process.env.FIXIAM_TOKEN_AUTH_METHOD || undefined,
  });
}

// ---------------------------------------------------------------- SCIM
const scimSchema = z.object({
  SCIM_TOKEN: z.string().min(32, "SCIM_TOKEN must be at least 32 characters"),
});
export function getScimEnv() {
  return parse("SCIM", scimSchema, { SCIM_TOKEN: process.env.SCIM_TOKEN });
}

/** Non-secret summary of which integrations are configured (for the Integration Settings page). */
export function getConfigStatus() {
  const check = (fn: () => unknown) => {
    try {
      fn();
      return { configured: true as const, missing: [] as string[] };
    } catch (e) {
      return { configured: false as const, missing: e instanceof ConfigError ? e.missing : ["unknown"] };
    }
  };
  return {
    database: check(getDbEnv),
    session: check(getSessionEnv),
    oidc: check(getOidcEnv),
    scim: check(getScimEnv),
  };
}
