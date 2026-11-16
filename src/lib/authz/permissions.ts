/**
 * Permission keys enforced by CAPS. The authoritative role → permission matrix is
 * stored in the database (role_permissions); these constants give type safety to
 * the code that checks them. Safe to import from client components (no secrets).
 */
export const PERMISSIONS = [
  "dashboard.view",
  "applicants.view",
  "applications.review",
  "admissions.approve",
  "admissions.reject",
  "admissions.hold",
  "reports.view",
  "users.view",
  "access.view",
  "access.manage",
  "scim.logs.view",
  "audit.view",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v);
}

export const DECISION_PERMISSION = {
  approved: "admissions.approve",
  rejected: "admissions.reject",
  on_hold: "admissions.hold",
} as const satisfies Record<string, Permission>;
