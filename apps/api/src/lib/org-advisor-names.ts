import { inArray } from "drizzle-orm";
import { db } from "db";
import { users } from "db/schema";

/** Resolve display names for organization advisor user ids (batch). */
export async function advisorDisplayNameByUserIds(
  userIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id != null && id !== ""))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}
