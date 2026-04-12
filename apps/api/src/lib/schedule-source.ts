/** 与 `schedule_items_cache.schedule_source` 一致。教务批量录入与学生门户同步均写入此来源，靠 `batch_id` 前缀区分。 */
export const SCHEDULE_SOURCE_SCHOOL = "school_gateway";

/** 教务批量下发行的 `batch_id` 的 LIKE 模式（前缀 `academic-pub:`）。 */
export const ACADEMIC_PUBLISH_BATCH_LIKE = "academic-pub:%";

export function academicPublishBatchId(): string {
  return `academic-pub:${crypto.randomUUID()}`;
}

export function schoolSyncBatchId(): string {
  return `school-sync:${crypto.randomUUID()}`;
}
