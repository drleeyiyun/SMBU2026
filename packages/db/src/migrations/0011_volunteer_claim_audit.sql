CREATE TYPE "public"."volunteer_claim_audit_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "student_volunteer_event_claims" ADD COLUMN "audit_status" "volunteer_claim_audit_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_volunteer_event_claims" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_volunteer_event_claims" ADD COLUMN "reviewer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "student_volunteer_event_claims" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "student_volunteer_event_claims" ADD CONSTRAINT "student_volunteer_event_claims_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint
UPDATE "student_volunteer_event_claims" SET "audit_status" = 'approved' WHERE true;
