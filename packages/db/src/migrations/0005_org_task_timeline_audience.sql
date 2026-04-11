CREATE TYPE "public"."org_task_timeline_audience" AS ENUM('assignees_only', 'org_members', 'all_students');
--> statement-breakpoint
ALTER TABLE "org_tasks" ADD COLUMN "timeline_audience" "org_task_timeline_audience" DEFAULT 'assignees_only' NOT NULL;
