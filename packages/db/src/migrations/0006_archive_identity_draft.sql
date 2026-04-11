ALTER TABLE "student_profiles" ADD COLUMN "student_no_draft" text;
--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "identity_draft" jsonb;
--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "identity_audit_status" text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "identity_audit_reason" text;
