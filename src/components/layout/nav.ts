import type { Permission } from "@/lib/authz/permissions";

export type NavIcon =
  | "dashboard" | "applicants" | "review" | "decisions" | "users" | "groups" | "roles" | "scim" | "audit" | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  anyOf: Permission[];
}

export const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", anyOf: ["dashboard.view"] }] },
  {
    section: "Admissions",
    items: [
      { href: "/applicants", label: "Applicants", icon: "applicants", anyOf: ["applicants.view"] },
      { href: "/reviews", label: "Application Review", icon: "review", anyOf: ["applications.review"] },
      { href: "/decisions", label: "Admission Decisions", icon: "decisions", anyOf: ["admissions.approve", "admissions.reject", "admissions.hold"] },
    ],
  },
  {
    section: "Identity & Access",
    items: [
      { href: "/users", label: "User Directory", icon: "users", anyOf: ["users.view"] },
      { href: "/groups", label: "Groups & Access", icon: "groups", anyOf: ["access.view"] },
      { href: "/roles", label: "Role & Permission Mapping", icon: "roles", anyOf: ["access.view"] },
      { href: "/scim-logs", label: "SCIM Sync Logs", icon: "scim", anyOf: ["scim.logs.view"] },
    ],
  },
  {
    section: "Administration",
    items: [
      { href: "/audit", label: "Audit Logs", icon: "audit", anyOf: ["audit.view"] },
      { href: "/settings", label: "Integration Settings", icon: "settings", anyOf: ["settings.manage"] },
    ],
  },
];
