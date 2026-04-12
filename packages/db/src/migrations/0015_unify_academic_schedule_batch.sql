-- 教务统一课表：原团委 batch 并入 school_gateway，batch 前缀改为 academic-pub:
UPDATE "schedule_items_cache"
SET
  "schedule_source" = 'school_gateway',
  "batch_id" = REPLACE("batch_id", 'league-pub:', 'academic-pub:')
WHERE "batch_id" LIKE 'league-pub:%';

UPDATE "schedule_items_cache"
SET "schedule_source" = 'school_gateway'
WHERE "schedule_source" = 'league_program';
