-- After 0012, league publishes shared school_gateway with sync; restore source for rows we can identify by batch id.
UPDATE "schedule_items_cache" SET "schedule_source" = 'league_program' WHERE "batch_id" LIKE 'league-pub:%';
