CREATE TYPE "public"."coordination_category" AS ENUM('practice', 'volunteer', 'work_study', 'general');--> statement-breakpoint
CREATE TABLE "league_coordination_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" "coordination_category" DEFAULT 'general' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "league_coordination_events" ADD CONSTRAINT "league_coordination_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_coordination_range_idx" ON "league_coordination_events" USING btree ("starts_at","ends_at");