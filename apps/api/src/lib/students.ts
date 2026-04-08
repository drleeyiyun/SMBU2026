import { eq } from "drizzle-orm";
import { db } from "db";
import { userRoles } from "db/schema";

export async function listStudentUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.role, "student"));
  return rows.map((r) => r.userId);
}
