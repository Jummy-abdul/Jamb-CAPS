CREATE TYPE "public"."actor_type" AS ENUM('user', 'fixiam_scim', 'fixiam_oidc', 'system', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."admission_decision" AS ENUM('approved', 'rejected', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('submitted', 'under_review', 'reviewed', 'on_hold', 'admitted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'denied', 'failure');--> statement-breakpoint
CREATE TYPE "public"."provisioning_source" AS ENUM('scim', 'sample', 'caps_native');--> statement-breakpoint
CREATE TYPE "public"."review_recommendation" AS ENUM('recommend_admission', 'recommend_rejection', 'requires_further_review');--> statement-breakpoint
CREATE TYPE "public"."role_mapping_source" AS ENUM('group_display_name', 'group_external_id');--> statement-breakpoint
CREATE TABLE "admission_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_no" text NOT NULL,
	"applicant_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"academic_session" text NOT NULL,
	"status" "application_status" DEFAULT 'submitted' NOT NULL,
	"post_utme_score" integer,
	"aggregate_score" numeric(5, 2),
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_applications_application_no_unique" UNIQUE("application_no")
);
--> statement-breakpoint
CREATE TABLE "admission_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"decision" "admission_decision" NOT NULL,
	"decided_by_id" uuid,
	"decided_by_name" text NOT NULL,
	"reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admission_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"reviewer_name" text NOT NULL,
	"recommendation" "review_recommendation",
	"notes" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_no" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"gender" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"state_of_origin" text NOT NULL,
	"lga" text,
	"utme_score" integer NOT NULL,
	"utme_subjects" jsonb NOT NULL,
	"o_level_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicants_registration_no_unique" UNIQUE("registration_no")
);
--> statement-breakpoint
CREATE TABLE "application_roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"outcome" "audit_outcome" DEFAULT 'success' NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"details" jsonb,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text,
	"description" text,
	"provisioning_source" "provisioning_source" NOT NULL,
	"scim_attributes" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"ownership" text NOT NULL,
	"state" text NOT NULL,
	CONSTRAINT "institutions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "oidc_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_hash" text NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"return_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oidc_transactions_binding_hash_unique" UNIQUE("binding_hash")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"name" text NOT NULL,
	"faculty" text NOT NULL,
	"cutoff_mark" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "role_mapping_source" NOT NULL,
	"source_value" text NOT NULL,
	"role_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_key" text NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_key_permission_key_pk" PRIMARY KEY("role_key","permission_key")
);
--> statement-breakpoint
CREATE TABLE "scim_sync_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" text,
	"resource_type" text,
	"resource_id" text,
	"operation" text NOT NULL,
	"status_code" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"summary" text,
	"request_body" jsonb,
	"error_detail" text,
	"client_ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"source_group_id" uuid,
	"source_group_name" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"id_token" text,
	"auth_time" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_name" text NOT NULL,
	"external_id" text,
	"fixiam_sub" text,
	"given_name" text,
	"family_name" text,
	"display_name" text,
	"email" text,
	"title" text,
	"department" text,
	"active" boolean DEFAULT true NOT NULL,
	"provisioning_source" "provisioning_source" NOT NULL,
	"sample_role_label" text,
	"scim_attributes" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_decisions" ADD CONSTRAINT "admission_decisions_application_id_admission_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."admission_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_decisions" ADD CONSTRAINT "admission_decisions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_reviews" ADD CONSTRAINT "admission_reviews_application_id_admission_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."admission_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_reviews" ADD CONSTRAINT "admission_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_mappings" ADD CONSTRAINT "role_mappings_role_key_application_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."application_roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_key_application_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."application_roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_role_key_application_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."application_roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_source_group_id_groups_id_fk" FOREIGN KEY ("source_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_applications_applicant_session_uq" ON "admission_applications" USING btree ("applicant_id","academic_session");--> statement-breakpoint
CREATE INDEX "admission_applications_status_idx" ON "admission_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "admission_applications_institution_idx" ON "admission_applications" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "admission_decisions_application_idx" ON "admission_decisions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "admission_reviews_application_idx" ON "admission_reviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "applicants_name_idx" ON "applicants" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_category_idx" ON "audit_logs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "group_memberships_user_idx" ON "group_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_display_name_live_uq" ON "groups" USING btree (lower("display_name")) WHERE "groups"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_external_id_live_uq" ON "groups" USING btree ("external_id") WHERE "groups"."deleted_at" is null and "groups"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "programmes_inst_name_uq" ON "programmes" USING btree ("institution_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "role_mappings_uq" ON "role_mappings" USING btree ("source_type",lower("source_value"),"role_key");--> statement-breakpoint
CREATE INDEX "scim_sync_logs_occurred_idx" ON "scim_sync_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "scim_sync_logs_resource_idx" ON "scim_sync_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_entitlements_active_uq" ON "user_entitlements" USING btree ("user_id","role_key","source_group_id") WHERE "user_entitlements"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "user_entitlements_user_idx" ON "user_entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_uq" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_user_name_live_uq" ON "users" USING btree (lower("user_name")) WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_id_live_uq" ON "users" USING btree ("external_id") WHERE "users"."deleted_at" is null and "users"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_fixiam_sub_live_uq" ON "users" USING btree ("fixiam_sub") WHERE "users"."deleted_at" is null and "users"."fixiam_sub" is not null;--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_source_idx" ON "users" USING btree ("provisioning_source");