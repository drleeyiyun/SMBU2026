-- Legacy league publishes used schedule_source = 'league_program'; unify into school_gateway (教务课表缓存).
UPDATE "schedule_items_cache" SET "schedule_source" = 'school_gateway' WHERE "schedule_source" = 'league_program';
