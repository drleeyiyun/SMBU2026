CREATE TABLE "student_volunteer_event_claims" (
	"user_id" uuid NOT NULL,
	"coordination_event_id" uuid NOT NULL,
	"claimed_hours" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_volunteer_event_claims_user_id_coordination_event_id_pk" PRIMARY KEY("user_id","coordination_event_id")
);
--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "student_no" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "basic_i18n_published" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "basic_i18n_draft" jsonb;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "basic_audit_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "basic_audit_reason" text;--> statement-breakpoint
ALTER TABLE "student_volunteer_event_claims" ADD CONSTRAINT "student_volunteer_event_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_volunteer_event_claims" ADD CONSTRAINT "student_volunteer_event_claims_coordination_event_id_league_coordination_events_id_fk" FOREIGN KEY ("coordination_event_id") REFERENCES "public"."league_coordination_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_no_uidx" ON "student_profiles" USING btree ("student_no") WHERE "student_profiles"."student_no" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vr_volunteer_external_uidx" ON "volunteer_records" USING btree ("volunteer_number","external_ref") WHERE "volunteer_records"."external_ref" IS NOT NULL;