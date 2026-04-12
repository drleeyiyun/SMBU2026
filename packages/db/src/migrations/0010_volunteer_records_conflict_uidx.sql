-- Partial unique index cannot be used as arbiter for `ON CONFLICT (volunteer_number, external_ref)`.
-- Replace with a full unique index: PostgreSQL still allows multiple rows with `external_ref` NULL
-- (NULLs do not collide in UNIQUE), while non-null pairs stay unique.
DROP INDEX IF EXISTS "vr_volunteer_external_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "vr_volunteer_external_uidx" ON "volunteer_records" USING btree ("volunteer_number","external_ref");
