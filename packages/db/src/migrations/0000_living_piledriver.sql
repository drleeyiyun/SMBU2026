CREATE TYPE "public"."ability_tag_category" AS ENUM('technical', 'planning', 'management', 'sports');--> statement-breakpoint
CREATE TYPE "public"."award_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('zh', 'en', 'ru');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('archive_audit', 'task_status');--> statement-breakpoint
CREATE TYPE "public"."org_lifecycle" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."task_assign_status" AS ENUM('unread', 'read', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."org_task_kind" AS ENUM('single', 'cross', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'org_member', 'org_officer', 'org_president', 'league_admin', 'instructor');--> statement-breakpoint
CREATE TABLE "ability_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "ability_tag_category" NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"proof_url" text,
	"status" "award_status" DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" uuid,
	"reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"payload_json" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	CONSTRAINT "org_memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organization_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"payload_json" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" uuid,
	"review_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_task_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"status" "task_assign_status" DEFAULT 'unread' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_task_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_task_involved_orgs" (
	"task_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	CONSTRAINT "org_task_involved_orgs_task_id_org_id_pk" PRIMARY KEY("task_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "org_task_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"assignment_id" uuid,
	"actor_user_id" uuid,
	"from_status" "task_assign_status",
	"to_status" "task_assign_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" "org_task_kind" NOT NULL,
	"created_by_user_id" uuid,
	"league_visible" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_full" text NOT NULL,
	"name_short" text NOT NULL,
	"logo_url" text,
	"org_type" text NOT NULL,
	"lifecycle_status" "org_lifecycle" DEFAULT 'pending' NOT NULL,
	"advisor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"on_timeline" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_items_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"batch_id" text
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"volunteer_number" text NOT NULL,
	"nationality" text NOT NULL,
	"id_number" text NOT NULL,
	"grade" text NOT NULL,
	"department" text NOT NULL,
	"major" text NOT NULL,
	"class_name" text NOT NULL,
	"id_photo_url" text,
	"portrait_url" text,
	"phone" text,
	"wechat" text,
	"github" text,
	"weibo" text,
	"profile_draft_phone" text,
	"profile_draft_wechat" text,
	"profile_audit_status" text DEFAULT 'none' NOT NULL,
	"profile_audit_reason" text
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"preferred_locale" "locale" DEFAULT 'zh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "volunteer_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_number" text NOT NULL,
	"title" text NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"source" text NOT NULL,
	"external_ref" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ability_tags" ADD CONSTRAINT "ability_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_revisions" ADD CONSTRAINT "organization_revisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_revisions" ADD CONSTRAINT "organization_revisions_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_assignments" ADD CONSTRAINT "org_task_assignments_task_id_org_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."org_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_assignments" ADD CONSTRAINT "org_task_assignments_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_handoffs" ADD CONSTRAINT "org_task_handoffs_task_id_org_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."org_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_handoffs" ADD CONSTRAINT "org_task_handoffs_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_handoffs" ADD CONSTRAINT "org_task_handoffs_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_involved_orgs" ADD CONSTRAINT "org_task_involved_orgs_task_id_org_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."org_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_involved_orgs" ADD CONSTRAINT "org_task_involved_orgs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_status_events" ADD CONSTRAINT "org_task_status_events_task_id_org_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."org_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_status_events" ADD CONSTRAINT "org_task_status_events_assignment_id_org_task_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."org_task_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_task_status_events" ADD CONSTRAINT "org_task_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_tasks" ADD CONSTRAINT "org_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_advisor_user_id_users_id_fk" FOREIGN KEY ("advisor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_plans" ADD CONSTRAINT "personal_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items_cache" ADD CONSTRAINT "schedule_items_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_user_starts_idx" ON "schedule_items_cache" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_number_uidx" ON "student_profiles" USING btree ("volunteer_number");--> statement-breakpoint
CREATE INDEX "vr_volunteer_number_idx" ON "volunteer_records" USING btree ("volunteer_number");