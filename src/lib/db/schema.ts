import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
  numeric,
} from "drizzle-orm/pg-core";

/* =============================================================================
 * Enumerations
 * ========================================================================== */

/**
 * Where an identity/group record came from.
 *  - scim:        created/managed by Fixiam over SCIM (the real integration path)
 *  - sample:      fictional demonstration record seeded locally (never presented as provisioned)
 *  - caps_native: group that pre-existed in CAPS (available to Fixiam's "import groups" workflow)
 */
export const provisioningSource = pgEnum("provisioning_source", ["scim", "sample", "caps_native"]);

export const applicationStatus = pgEnum("application_status", [
  "submitted",
  "under_review",
  "reviewed",
  "on_hold",
  "admitted",
  "rejected",
]);

export const reviewRecommendation = pgEnum("review_recommendation", [
  "recommend_admission",
  "recommend_rejection",
  "requires_further_review",
]);

export const admissionDecision = pgEnum("admission_decision", ["approved", "rejected", "on_hold"]);

export const actorType = pgEnum("actor_type", ["user", "fixiam_scim", "fixiam_oidc", "system", "anonymous"]);

export const auditOutcome = pgEnum("audit_outcome", ["success", "denied", "failure"]);

export const roleMappingSource = pgEnum("role_mapping_source", [
  "group_display_name",
  "group_external_id",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* =============================================================================
 * Identity (provisioned from Fixiam)
 * ========================================================================== */

export const users = pgTable(
  "users",
  {
    /** CAPS-assigned identifier; exposed as the SCIM resource `id`. */
    id: uuid("id").primaryKey().defaultRandom(),
    userName: text("user_name").notNull(),
    /** SCIM externalId as supplied by Fixiam. */
    externalId: text("external_id"),
    /** OIDC `sub` claim from Fixiam, linked on first successful login. */
    fixiamSub: text("fixiam_sub"),
    givenName: text("given_name"),
    familyName: text("family_name"),
    displayName: text("display_name"),
    email: text("email"),
    title: text("title"),
    department: text("department"),
    active: boolean("active").notNull().default(true),
    provisioningSource: provisioningSource("provisioning_source").notNull(),
    /** Fictional role label shown for sample records only. Never used for authorization. */
    sampleRoleLabel: text("sample_role_label"),
    /** Full SCIM attributes as last received (multi-valued emails, roles, extensions...). */
    scimAttributes: jsonb("scim_attributes").$type<Record<string, unknown>>(),
    /** SCIM meta.version counter. */
    version: integer("version").notNull().default(1),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    /** Soft delete: set when Fixiam deprovisions the user (SCIM DELETE). Kept for audit history. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_user_name_live_uq").on(sql`lower(${t.userName})`).where(sql`${t.deletedAt} is null`),
    uniqueIndex("users_external_id_live_uq").on(t.externalId).where(sql`${t.deletedAt} is null and ${t.externalId} is not null`),
    uniqueIndex("users_fixiam_sub_live_uq").on(t.fixiamSub).where(sql`${t.deletedAt} is null and ${t.fixiamSub} is not null`),
    index("users_email_idx").on(sql`lower(${t.email})`),
    // Email uniqueness among live, Fixiam-provisioned users. Required for reliable
    // email-based OIDC matching; an email resolves to at most one account.
    uniqueIndex("users_email_scim_live_uq")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null and ${t.email} is not null and ${t.provisioningSource} = 'scim'`),
    index("users_source_idx").on(t.provisioningSource),
  ],
);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    externalId: text("external_id"),
    description: text("description"),
    provisioningSource: provisioningSource("provisioning_source").notNull(),
    scimAttributes: jsonb("scim_attributes").$type<Record<string, unknown>>(),
    version: integer("version").notNull().default(1),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("groups_display_name_live_uq").on(sql`lower(${t.displayName})`).where(sql`${t.deletedAt} is null`),
    uniqueIndex("groups_external_id_live_uq").on(t.externalId).where(sql`${t.deletedAt} is null and ${t.externalId} is not null`),
  ],
);

export const groupMemberships = pgTable(
  "group_memberships",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_memberships_user_idx").on(t.userId)],
);

/* =============================================================================
 * Authorization model
 * ========================================================================== */

export const applicationRoles = pgTable("application_roles", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleKey: text("role_key").notNull().references(() => applicationRoles.key, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull().references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleKey, t.permissionKey] })],
);

/**
 * Configurable mapping from Fixiam-provisioned groups to CAPS application roles.
 * Groups themselves are created dynamically by Fixiam; a mapping matches them by
 * display name (case-insensitive) or by SCIM externalId.
 */
export const roleMappings = pgTable(
  "role_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: roleMappingSource("source_type").notNull(),
    sourceValue: text("source_value").notNull(),
    roleKey: text("role_key").notNull().references(() => applicationRoles.key, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    createdBy: text("created_by").notNull().default("system"),
    ...timestamps,
  },
  (t) => [uniqueIndex("role_mappings_uq").on(t.sourceType, sql`lower(${t.sourceValue})`, t.roleKey)],
);

/**
 * Materialised effective role grants with full history. Recomputed whenever group
 * membership, groups or mappings change. Active grants have revoked_at = null.
 */
export const userEntitlements = pgTable(
  "user_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull().references(() => applicationRoles.key, { onDelete: "cascade" }),
    sourceGroupId: uuid("source_group_id").references(() => groups.id, { onDelete: "set null" }),
    sourceGroupName: text("source_group_name"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    uniqueIndex("user_entitlements_active_uq")
      .on(t.userId, t.roleKey, t.sourceGroupId)
      .where(sql`${t.revokedAt} is null`),
    index("user_entitlements_user_idx").on(t.userId),
  ],
);

/* =============================================================================
 * Sessions & OIDC transactions
 * ========================================================================== */

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** HMAC-SHA256 of the opaque cookie token. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Kept server-side only, used as id_token_hint for RP-initiated logout. */
    idToken: text("id_token"),
    authTime: timestamp("auth_time", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
  },
  (t) => [uniqueIndex("user_sessions_token_uq").on(t.tokenHash), index("user_sessions_user_idx").on(t.userId)],
);

/** Short-lived OIDC login transaction (state, nonce, PKCE verifier) bound to a browser cookie. */
export const oidcTransactions = pgTable("oidc_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  bindingHash: text("binding_hash").notNull().unique(),
  state: text("state").notNull(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  returnTo: text("return_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/* =============================================================================
 * Admissions domain (fictional data)
 * ========================================================================== */

export const institutions = pgTable("institutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  ownership: text("ownership").notNull(),
  state: text("state").notNull(),
});

export const programmes = pgTable(
  "programmes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    faculty: text("faculty").notNull(),
    cutoffMark: integer("cutoff_mark").notNull(),
  },
  (t) => [uniqueIndex("programmes_inst_name_uq").on(t.institutionId, t.name)],
);

export const applicants = pgTable(
  "applicants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationNo: text("registration_no").notNull().unique(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    gender: text("gender").notNull(),
    dateOfBirth: date("date_of_birth").notNull(),
    stateOfOrigin: text("state_of_origin").notNull(),
    lga: text("lga"),
    utmeScore: integer("utme_score").notNull(),
    utmeSubjects: jsonb("utme_subjects").$type<{ subject: string; score: number }[]>().notNull(),
    oLevelSummary: text("o_level_summary"),
    ...timestamps,
  },
  (t) => [index("applicants_name_idx").on(t.lastName, t.firstName)],
);

export const admissionApplications = pgTable(
  "admission_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationNo: text("application_no").notNull().unique(),
    applicantId: uuid("applicant_id").notNull().references(() => applicants.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id),
    programmeId: uuid("programme_id").notNull().references(() => programmes.id),
    academicSession: text("academic_session").notNull(),
    status: applicationStatus("status").notNull().default("submitted"),
    postUtmeScore: integer("post_utme_score"),
    aggregateScore: numeric("aggregate_score", { precision: 5, scale: 2 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("admission_applications_applicant_session_uq").on(t.applicantId, t.academicSession),
    index("admission_applications_status_idx").on(t.status),
    index("admission_applications_institution_idx").on(t.institutionId),
  ],
);

export const admissionReviews = pgTable(
  "admission_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id").notNull().references(() => admissionApplications.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    reviewerName: text("reviewer_name").notNull(),
    recommendation: reviewRecommendation("recommendation"),
    notes: text("notes").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admission_reviews_application_idx").on(t.applicationId)],
);

export const admissionDecisions = pgTable(
  "admission_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id").notNull().references(() => admissionApplications.id, { onDelete: "cascade" }),
    decision: admissionDecision("decision").notNull(),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedByName: text("decided_by_name").notNull(),
    reason: text("reason"),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admission_decisions_application_idx").on(t.applicationId)],
);

/* =============================================================================
 * Audit & synchronisation logs
 * ========================================================================== */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    category: text("category").notNull(),
    action: text("action").notNull(),
    outcome: auditOutcome("outcome").notNull().default("success"),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: text("actor_label").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    /** True for fictional history seeded with the sample data. */
    isSample: boolean("is_sample").notNull().default(false),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
  },
  (t) => [
    index("audit_logs_occurred_idx").on(t.occurredAt),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_category_idx").on(t.category),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
  ],
);

export const scimSyncLogs = pgTable(
  "scim_sync_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    query: text("query"),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    operation: text("operation").notNull(),
    statusCode: integer("status_code").notNull(),
    durationMs: integer("duration_ms").notNull(),
    summary: text("summary"),
    /** Request body with sensitive attributes (e.g. password) removed. */
    requestBody: jsonb("request_body"),
    errorDetail: text("error_detail"),
    clientIp: text("client_ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("scim_sync_logs_occurred_idx").on(t.occurredAt), index("scim_sync_logs_resource_idx").on(t.resourceType, t.resourceId)],
);
