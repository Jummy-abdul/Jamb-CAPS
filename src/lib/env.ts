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
